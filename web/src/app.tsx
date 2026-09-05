import { useEffect, useState } from 'react'
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

  const [livePreview, setLivePreview] = useState(() => localStorage.getItem('livePreview') !== 'off')
  const [sidebarOpen, setSidebarOpen] = useState(false)

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

  if (phase === 'loading') {
    return <div className="splash">…</div>
  }
  if (phase === 'login') {
    return <LoginScreen />
  }

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sync === 'needs-login' && <SignedOutBanner />}
      <Sidebar onNavigate={() => setSidebarOpen(false)} />
      <main className="pane">
        <NoteEditor livePreview={livePreview} />
      </main>
      <Notices />
      <StatusBar
        livePreview={livePreview}
        onToggleLivePreview={() => setLivePreview((v) => !v)}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
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
