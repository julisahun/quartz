import { useState, type FormEvent } from 'react'
import { ApiError, OfflineError } from '../api/client'
import { useApp } from '../state/store'

export function LoginScreen() {
  const login = useApp((s) => s.login)
  const [user, setUser] = useState('juli')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(user, password)
    } catch (err) {
      if (err instanceof OfflineError) setError('Cannot reach the server from here.')
      else if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a few minutes.')
      else if (err instanceof ApiError && err.isAuth) setError('Wrong user or password.')
      else setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>quartz</h1>
        <p className="muted">Your notes, on your own machine.</p>
        <label>
          User
          <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
