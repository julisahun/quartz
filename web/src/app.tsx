import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs } from './ui/dialogs'
import { useSwipeBack } from './ui/gestures'
import { useIsPhone } from './ui/media'
import { Notices } from './ui/Notices'
import { NoteEditor } from './ui/NoteEditor'
import { QuickOpen } from './ui/QuickOpen'
import { Sidebar } from './ui/Sidebar'
import { StatusBar } from './ui/StatusBar'
import { LoginScreen } from './ui/LoginScreen'
import { foldersSupported } from './vault/folders'
import { trackViewport } from './editor/mobile'
import { startBackgroundSync, useApp } from './state/store'
import { noteTitle } from './state/notes'

export function App() {
  const phase = useApp((s) => s.phase)
  const boot = useApp((s) => s.boot)
  const currentPath = useApp((s) => s.currentPath)
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
  const { screen, showNote, back } = useScreens(isPhone)
  // The node, not a ref: the pane only exists once boot leaves the splash, and
  // an effect keyed on a ref object would never see it arrive.
  const [pane, setPane] = useState<HTMLElement | null>(null)

  useSwipeBack(pane, { enabled: isPhone && screen === 'note', onBack: back })

  useEffect(() => {
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
  // browser's print dialog, which is the trade all of them have made.
  //
  // Only the platform's own modifier: on a Mac, Ctrl-P is still the emacs
  // "up a line" that CodeMirror binds inside the editor, and taking that away
  // from the people who use it would not be worth a second way to do this.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'p' || event.altKey || event.shiftKey) return
      if (isMac() ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      setQuickOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    document.title = currentPath ? `${noteTitle(currentPath)} — Quartz` : 'Quartz'
  }, [currentPath])

  // A note can go away underneath the screen showing it — deleted here, or
  // pulled as a delete from another device.
  useEffect(() => {
    if (screen === 'note' && !currentPath) back()
  }, [screen, currentPath, back])

  if (phase === 'loading') {
    return <div className="splash">…</div>
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

  return (
    <div className={`app ${isPhone ? `phone screen-${screen}` : 'wide'}`}>
      {lostSession && <SignedOutBanner />}
      <Sidebar onNavigate={showNote} inert={isPhone && screen === 'note'} />
      <main className="pane" ref={setPane} inert={isPhone && screen === 'list'}>
        <NoteEditor
          livePreview={livePreview}
          onToggleLivePreview={() => setLivePreview((v) => !v)}
          onBack={back}
        />
      </main>
      <Notices />
      <StatusBar livePreview={livePreview} onToggleLivePreview={() => setLivePreview((v) => !v)} />
      <QuickOpen open={quickOpen} onClose={() => setQuickOpen(false)} onOpened={showNote} />
      <Dialogs />
    </div>
  )
}

function isMac(): boolean {
  return /Mac|iP(hone|od|ad)/.test(navigator.platform || navigator.userAgent)
}

type Screen = 'list' | 'note'

/**
 * One screen at a time on a phone, with the back gesture and the browser's own
 * back button both meaning the same thing. The note screen is a history entry,
 * so a swipe from the edge of a standalone PWA does what it does everywhere
 * else on the device.
 */
function useScreens(enabled: boolean) {
  const [screen, setScreen] = useState<Screen>('list')
  const pushed = useRef(false)

  useEffect(() => {
    const onPop = () => {
      pushed.current = false
      setScreen('list')
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const showNote = useCallback(() => {
    if (!enabled) return
    if (!pushed.current) {
      pushed.current = true
      history.pushState({ quartz: 'note' }, '')
    }
    setScreen('note')
  }, [enabled])

  const back = useCallback(() => {
    if (pushed.current) {
      // popstate does the rest, so there is one path out of the note screen.
      history.back()
      return
    }
    setScreen('list')
  }, [])

  // Growing past the phone breakpoint shows both panes at once; the pushed
  // entry is harmless, and stays until it is popped.
  useEffect(() => {
    if (!enabled) setScreen('list')
  }, [enabled])

  return { screen, showNote, back }
}

/**
 * Signed in, with nothing to open.
 *
 * Creating an account no longer creates a vault for it, so an account starts
 * out owning nothing and this is what it sees. It is not a dead end: a vault
 * is made by publishing a folder, so the way forward is the same "open a
 * folder" this app offers everywhere else — and the way out is signing out,
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
          machine, then <b>sync…</b> to publish it here.
        </p>
        {foldersSupported() ? (
          <button className="primary" onClick={() => void openFolder()}>
            Open a folder
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
