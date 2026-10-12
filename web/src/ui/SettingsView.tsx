import { useCallback, useEffect, useState } from 'react'
import { homeOf, setHome, useHomeSources, type HomeChoice } from '../state/home'
import { persisted } from '../state/persist'
import { humanSize } from '../state/notes'
import { storageEstimate } from '../state/storage'
import { useApp } from '../state/store'
import { isDesktop } from '../vault/tauri-bridge'
import { promptChangePassword, promptSignOut } from './actions'
import { AppBar } from './AppBar'
import { askText, openMenu } from './dialogs'
import { useSwipeBack } from './gestures'
import { ChevronLeft } from './icons'
import { useIsPhone } from './media'
import { Slot } from './Slot'

/**
 * Settings, over the whole app.
 *
 * A cover rather than a screen swap, so the editor underneath keeps its
 * CodeMirror state — undo history and cursor included — while somebody looks
 * at a preference. The app stays mounted and goes inert behind it.
 *
 * What belongs here is what a person sets and forgets: the account, this
 * device, and what is turned on. What does *not* is anything that acts on the
 * vault in front of you — switch vault, sync now, rename, delete — which stays
 * on the bars and in the `⋯` sheets where the thing it acts on is visible.
 */
export function SettingsView({ onBack }: { onBack: () => void }) {
  const isPhone = useIsPhone()
  const [root, setRoot] = useState<HTMLElement | null>(null)

  // The same edge swipe the note screen has. Without it, settings would be the
  // one screen on a phone that has to be dismissed by aiming at a button.
  useSwipeBack(root, { enabled: isPhone, onBack })

  return (
    <div className="settings" ref={setRoot}>
      <AppBar
        leading={
          <button className="icon-button" onClick={onBack} aria-label="Back">
            <ChevronLeft />
          </button>
        }
        title="Settings"
      />
      <div className="settings-scroll">
        <p className="settings-lede muted">
          These belong to this device. A phone and a laptop can disagree, and none of it
          syncs.
        </p>
        <Account />
        <Device />
        <Home />
        <Slot name="settings.sections" />
      </div>
    </div>
  )
}

/**
 * The account half.
 *
 * Signing in has to be reachable from here, and this is now the only place it
 * is: a folder opened from disk keeps the app in `ready` for ever, so nothing
 * else would ever show the login screen on a device that has no session.
 */
function Account() {
  const user = useApp((s) => s.user)
  const signedIn = useApp((s) => s.signedIn)
  const showLogin = useApp((s) => s.showLogin)

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>Account</h2>
      </div>
      {signedIn ? (
        <>
          <Row label="Signed in as" value={user} />
          <div className="settings-actions">
            <button className="button" onClick={() => void promptChangePassword()}>
              Change password…
            </button>
            <button className="button" onClick={() => void promptSignOut()}>
              Sign out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="settings-note muted">
            {user
              ? `Signed out of ${user}. Edits are safe here until you sign back in.`
              : 'No account on this device. One is needed to sync a folder to the server.'}
          </p>
          <div className="settings-actions">
            <button className="button primary" onClick={() => showLogin(true)}>
              Sign in…
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function Device() {
  const [device, setDevice] = useState(() => persisted.device())
  const [server, setServer] = useState(() => persisted.serverUrl() ?? '')
  const space = useSpace()
  const desktop = isDesktop()

  const rename = useCallback(async () => {
    const next = await askText({
      title: 'Rename this device',
      label: 'Name',
      value: device,
      confirmLabel: 'Rename',
    })
    if (!next) return
    persisted.setDevice(next)
    setDevice(next)
  }, [device])

  const repoint = useCallback(async () => {
    const next = await askText({
      title: 'Server',
      label: 'Address',
      value: server,
      confirmLabel: 'Save',
    })
    if (!next) return
    persisted.setServerUrl(next)
    setServer(next)
  }, [server])

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>This device</h2>
      </div>
      <Row
        label="Name"
        value={device}
        hint="Written into the filename of any conflict copy this device makes."
        action={{ label: 'Rename…', run: () => void rename() }}
      />
      {desktop && (
        <Row
          label="Server"
          value={server || 'notes.sigint.page'}
          hint="Read at start-up, so a change takes effect next launch."
          action={{ label: 'Change…', run: () => void repoint() }}
        />
      )}
      <Row
        label="Notes stored here"
        value={space ?? '—'}
        hint={
          space
            ? 'Vaults are held on this device so they open with the server off.'
            : 'This browser will not say.'
        }
      />
    </section>
  )
}

/**
 * The note the open vault starts on, here.
 *
 * Per vault, since a path means nothing outside its own, and per device like
 * everything else on this screen. What can be picked is a note, nothing — the
 * first note, as before there were homes — or whatever is on offer as a home
 * that works itself out, such as today's note.
 */
function Home() {
  const vault = useApp((s) => s.currentVault)
  const vaultName = useApp((s) => s.vaults.find((v) => v.id === s.currentVault)?.name)
  const files = useApp((s) => s.files)
  const notify = useApp((s) => s.notify)
  const { sources, version } = useHomeSources()
  // Re-read whenever a choice is written, here or by a source arriving.
  const [choice, setChoice] = useState<HomeChoice | undefined>()
  useEffect(() => setChoice(vault ? homeOf(vault) : undefined), [vault, version, sources])

  const change = useCallback(async () => {
    if (!vault) return
    // The menu runs what is picked; nothing to do with its answer.
    await openMenu('Open this vault on', [
      ...sources.map((source) => ({
        label: source.label,
        hint: source.by,
        run: () => setHome(vault, { kind: 'source', id: source.id, label: source.label }),
      })),
      {
        label: 'A note…',
        run: () => {
          void (async () => {
            const path = await askText({
              title: 'Home note',
              label: 'Path in the vault',
              value: choice?.kind === 'note' ? choice.path : '',
              confirmLabel: 'Save',
            })
            if (!path) return
            const clean = path.trim().replace(/^\/+/, '')
            if (!files.some((f) => f.path === clean)) {
              notify('error', `${clean} is not in this vault`)
              return
            }
            setHome(vault, { kind: 'note', path: clean })
          })()
        },
      },
      { label: 'The first note', hint: 'As before there was a home', run: () => setHome(vault, undefined) },
    ])
  }, [vault, sources, files, choice, notify])

  if (!vault) return null

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>Home</h2>
      </div>
      <Row
        label={vaultName ? `${vaultName} opens on` : 'Opens on'}
        value={describe(choice, sources)}
        hint="Where this vault starts when the app opens. Per vault, on this device."
        action={{ label: 'Change…', run: () => void change() }}
      />
    </section>
  )
}

function describe(choice: HomeChoice | undefined, sources: Array<{ id: string; by?: string }>): string {
  if (!choice) return 'The first note'
  if (choice.kind === 'note') return choice.path
  const source = sources.find((s) => s.id === choice.id)
  if (!source) return `${choice.label} (not available)`
  return source.by ? `${choice.label} — ${source.by}` : choice.label
}

function Row({
  label,
  value,
  hint,
  action,
}: {
  label: string
  value: string
  hint?: string
  action?: { label: string; run: () => void }
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-label">{label}</span>
        <span className="settings-value">{value}</span>
        {hint && <span className="settings-hint muted">{hint}</span>}
      </div>
      {action && (
        <button className="button" onClick={action.run} aria-label={`${action.label} ${label}`}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/**
 * How much of the device's quota the vaults are using.
 *
 * Worth showing because iOS evicts site data from apps it thinks are idle, and
 * the number is the only warning anyone gets that a vault is the size of a
 * thing worth evicting.
 */
function useSpace(): string | undefined {
  const [space, setSpace] = useState<string | undefined>()

  useEffect(() => {
    let live = true
    void storageEstimate().then((estimate) => {
      if (!live || !estimate) return
      setSpace(`${humanSize(estimate.usage)} of ${humanSize(estimate.quota)}`)
    })
    return () => {
      live = false
    }
  }, [])

  return space
}
