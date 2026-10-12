import { useEffect, useState } from 'react'
import { Dialogs } from './ui/dialogs'
import { useSwipeBack } from './ui/gestures'
import { isModKey, useIsPhone } from './ui/media'
import { Notices } from './ui/Notices'
import { NoteEditor } from './ui/NoteEditor'
import { QuickOpen } from './ui/QuickOpen'
import { useScreens } from './ui/screens'
import { ViewPane } from './ui/views'
import { SettingsView } from './ui/SettingsView'
import { Sidebar } from './ui/Sidebar'
import { StatusBar } from './ui/StatusBar'
import { LoginScreen } from './ui/LoginScreen'
import { foldersSupported } from './vault/folders'
import { trackViewport } from './editor/mobile'
import { onAskWhereVaultLives, startBackgroundSync, useApp } from './state/store'
import { noteTitle } from './state/notes'
import { askWhereVaultLives, promptNewNote } from './ui/actions'

export function App() {
  const phase = useApp((s) => s.phase)
  const boot = useApp((s) => s.boot)
  const currentPath = useApp((s) => s.currentPath)
  const currentView = useApp((s) => s.currentView)
  const viewOpened = useApp((s) => s.viewOpened)
  // Keyed on the session rather than on the sync light: a folder from disk
  // reports "local" whatever the session is doing, which used to swallow this
  // banner on the one device that most needed it.
  const lostSession = useApp((s) => !s.signedIn && s.user !== '')
  // Signed in and owning nothing. An account is not given a vault any more, so
  // this is the ordinary first screen for a new one rather than a fault.
  // Gated on the session, not just the count: between `phase: 'ready'` and the
  // vault list arriving there is one render with neither, and it must not flash
  // this screen at somebody who does have vaults.
  const noVaults = useApp((s) => s.signedIn && s.vaults.length === 0)
  const isPhone = useIsPhone()

  const [livePreview, setLivePreview] = useState(() => localStorage.getItem('livePreview') !== 'off')
  const [quickOpen, setQuickOpen] = useState(false)
  const { screen, showNote, showSettings, back } = useScreens(isPhone)
  // The node, not a ref: the pane only exists once boot leaves the splash, and
  // an effect keyed on a ref object would never see it arrive.
  const [pane, setPane] = useState<HTMLElement | null>(null)

  useSwipeBack(pane, { enabled: isPhone && screen === 'note', onBack: back })

  // A phone shows one screen at a time, so a home the app opened on would sit
  // behind the note list unannounced. The first landing goes to the note;
  // later ones — switching vault from the list — leave you where you were.
  const homeOpened = useApp((s) => s.homeOpened)
  const [landed, setLanded] = useState(false)
  useEffect(() => {
    if (landed || homeOpened === 0) return
    setLanded(true)
    showNote()
  }, [landed, homeOpened, showNote])

  // A view lives where a note does, so on a phone opening one is going there.
  useEffect(() => {
    if (viewOpened > 0) showNote()
  }, [viewOpened, showNote])

  useEffect(() => {
    // Registered before boot, which opens a vault and may have to ask.
    onAskWhereVaultLives(askWhereVaultLives)
    void boot()
    const stopSync = startBackgroundSync()
    const stopViewport = trackViewport()
    return () => {
      stopSync()
      stopViewport()
    }
  }, [boot])

  useEffect(() => {
    localStorage.setItem('livePreview', livePreview ? 'on' : 'off')
  }, [livePreview])

  // ⌘P — Ctrl-P away from a Mac — is the switcher, as it is in every editor
  // that has one. It is caught before the editor sees it, and it costs the
  // browser's print dialog, which is the trade all of them have made. ⌘N is
  // a new note, in the folder of the open one; a browser tab keeps ⌘N for a
  // new window, but the desktop app and an installed PWA hand it over.
  //
  // Only the platform's own modifier: on a Mac, Ctrl-P and Ctrl-N are still
  // the emacs "up" and "down a line" CodeMirror binds inside the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isModKey(event, 'p')) {
        event.preventDefault()
        event.stopPropagation()
        setQuickOpen((open) => !open)
      } else if (isModKey(event, 'n') && useApp.getState().currentVault) {
        event.preventDefault()
        event.stopPropagation()
        void promptNewNote().then((path) => path && showNote())
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [showNote])

  useEffect(() => {
    document.title = currentPath ? `${noteTitle(currentPath)} — Quartz` : 'Quartz'
  }, [currentPath])

  // A note can go away underneath the screen showing it — deleted here, or
  // pulled as a delete from another device.
  useEffect(() => {
    if (screen === 'note' && !currentPath && !currentView) back()
  }, [screen, currentPath, currentView, back])

  if (phase === 'loading') {
    return (
      <div className="splash" role="status" aria-label="Loading">
        <span className="splash-mark">Quartz</span>
      </div>
    )
  }
  if (phase === 'login') {
    return (
      <>
        <LoginScreen />
        <Dialogs />
      </>
    )
  }

  if (noVaults) {
    return (
      <>
        <NoVaults />
        <Notices />
        <Dialogs />
      </>
    )
  }

  const covered = screen === 'settings'

  return (
    <div className={`app ${isPhone ? `phone screen-${screen}` : 'wide'}`}>
      {lostSession && <SignedOutBanner />}
      <Sidebar onNavigate={showNote} inert={covered || (isPhone && screen === 'note')} />
      <main className="pane" ref={setPane} inert={covered || (isPhone && screen === 'list')}>
        {currentView ? (
          <ViewPane id={currentView} onBack={back} />
        ) : (
          <NoteEditor
            livePreview={livePreview}
            onToggleLivePreview={() => setLivePreview((v) => !v)}
            onBack={back}
            onQuickOpen={() => setQuickOpen(true)}
          />
        )}
      </main>
      <Notices />
      <StatusBar onOpenSettings={showSettings} />
      {covered && <SettingsView onBack={back} />}
      <QuickOpen open={quickOpen} onClose={() => setQuickOpen(false)} onOpened={showNote} />
      <Dialogs />
    </div>
  )
}

/**
 * Signed in, with nothing to open.
 *
 * Creating an account no longer creates a vault for it, so an account starts
 * out owning nothing and this is what it sees. It is not a dead end: a vault
 * is made by publishing a folder, so the way forward is the same "open a
 * vault" this app offers everywhere else — and the way out is signing out,
 * which has to stay reachable from here or a new account would be stuck.
 */
function NoVaults() {
  const user = useApp((s) => s.user)
  const openFolder = useApp((s) => s.openFolder)
  const logout = useApp((s) => s.logout)

  return (
    <div className="login">
      <div className="login-card">
        <h1>Nothing open yet</h1>
        <p className="muted">
          Signed in as {user}. A vault is a folder of markdown files: open one from this
          machine, then choose <b>Publish to server…</b> from its ⋯ menu.
        </p>
        {foldersSupported() ? (
          <button className="primary" onClick={() => void openFolder()}>
            Open a vault
          </button>
        ) : (
          <p className="muted">
            This browser cannot open a folder of its own — use the desktop app, or a
            Chromium browser, and this account's vaults will follow.
          </p>
        )}
      </div>
      <button className="ghost login-alt" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  )
}

/**
 * The session expired. Editing carries on offline and nothing is dropped —
 * this is a prompt, not a wall.
 */
function SignedOutBanner() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const user = useApp((s) => s.user)
  const login = useApp((s) => s.login)

  return (
    <div className="banner">
      <span>Signed out. Your edits are safe here until you sign back in.</span>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          void login(user, password).finally(() => {
            setBusy(false)
            setPassword('')
          })
        }}
      >
        <input
          type="password"
          value={password}
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <button type="submit" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </div>
  )
}
