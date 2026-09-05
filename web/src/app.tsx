import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialogs } from './ui/dialogs'
import { useSwipeBack } from './ui/gestures'
import { useIsPhone } from './ui/media'
import { Notices } from './ui/Notices'
import { NoteEditor } from './ui/NoteEditor'
import { Sidebar } from './ui/Sidebar'
import { StatusBar } from './ui/StatusBar'
import { LoginScreen } from './ui/LoginScreen'
import { trackViewportHeight } from './editor/mobile'
import { startBackgroundSync, useApp } from './state/store'
import { noteTitle } from './state/notes'

export function App() {
  const phase = useApp((s) => s.phase)
  const boot = useApp((s) => s.boot)
  const currentPath = useApp((s) => s.currentPath)
  const sync = useApp((s) => s.sync)
  const isPhone = useIsPhone()

  const [livePreview, setLivePreview] = useState(() => localStorage.getItem('livePreview') !== 'off')
  const { screen, showNote, back } = useScreens(isPhone)
  // The node, not a ref: the pane only exists once boot leaves the splash, and
  // an effect keyed on a ref object would never see it arrive.
  const [pane, setPane] = useState<HTMLElement | null>(null)

  useSwipeBack(pane, { enabled: isPhone && screen === 'note', onBack: back })

  useEffect(() => {
    void boot()
    const stopSync = startBackgroundSync()
    const stopViewport = trackViewportHeight()
    return () => {
      stopSync()
      stopViewport()
    }
  }, [boot])

  useEffect(() => {
    localStorage.setItem('livePreview', livePreview ? 'on' : 'off')
  }, [livePreview])

  useEffect(() => {
    document.title = currentPath ? `${noteTitle(currentPath)} — quartz` : 'quartz'
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

  return (
    <div className={`app ${isPhone ? `phone screen-${screen}` : 'wide'}`}>
      {sync === 'needs-login' && <SignedOutBanner />}
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
      <Dialogs />
    </div>
  )
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
          void login(user || 'juli', password).finally(() => {
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
