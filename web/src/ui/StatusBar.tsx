import { useApp, type SyncState } from '../state/store'
import { noteTitle } from '../state/notes'

interface Props {
  livePreview: boolean
  onToggleLivePreview: () => void
  onToggleSidebar: () => void
}

const label: Record<SyncState, string> = {
  idle: 'synced',
  syncing: 'syncing…',
  offline: 'offline',
  'needs-login': 'signed out',
  error: 'sync failed',
}

export function StatusBar({ livePreview, onToggleLivePreview, onToggleSidebar }: Props) {
  const sync = useApp((s) => s.sync)
  const pending = useApp((s) => s.pending)
  const unsaved = useApp((s) => s.unsaved)
  const currentPath = useApp((s) => s.currentPath)
  const syncNow = useApp((s) => s.syncNow)
  const deleteNote = useApp((s) => s.deleteNote)
  const renameNote = useApp((s) => s.renameNote)
  const logout = useApp((s) => s.logout)

  async function rename() {
    if (!currentPath) return
    const next = prompt('New name', currentPath)
    if (!next || next === currentPath) return
    await renameNote(currentPath, next)
  }

  async function remove() {
    if (!currentPath) return
    if (!confirm(`Delete ${noteTitle(currentPath)}? It stays in the vault's git history.`)) return
    await deleteNote(currentPath)
  }

  return (
    <footer className="status">
      <button className="ghost only-narrow" onClick={onToggleSidebar} title="Notes">
        ☰
      </button>
      <button className={`status-sync ${sync}`} onClick={() => void syncNow()} title="Sync now">
        <span className="dot" />
        {label[sync]}
        {pending > 0 && <span className="pending">{pending} queued</span>}
      </button>
      {unsaved && <span className="muted">unsaved…</span>}
      <span className="spacer" />
      {currentPath && (
        <>
          <button className="ghost" onClick={onToggleLivePreview} title="Toggle live preview">
            {livePreview ? 'preview' : 'source'}
          </button>
          <button className="ghost" onClick={() => void rename()}>
            rename
          </button>
          <button className="ghost danger" onClick={() => void remove()}>
            delete
          </button>
        </>
      )}
      <button className="ghost" onClick={() => void logout()}>
        sign out
      </button>
    </footer>
  )
}
