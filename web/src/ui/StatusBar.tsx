import { useApp, type SyncState } from '../state/store'
import { promptDelete, promptRename, promptSignOut } from './actions'
import { useIsPhone } from './media'

interface Props {
  livePreview: boolean
  onToggleLivePreview: () => void
}

const label: Record<SyncState, string> = {
  idle: 'synced',
  syncing: 'syncing…',
  offline: 'offline',
  'needs-login': 'signed out',
  error: 'sync failed',
}

/**
 * On a phone this is only the sync light: everything else moved into the
 * overflow menus, where a target can be a finger wide. On a desktop it stays
 * the row of actions it has always been.
 */
export function StatusBar({ livePreview, onToggleLivePreview }: Props) {
  const sync = useApp((s) => s.sync)
  const pending = useApp((s) => s.pending)
  const unsaved = useApp((s) => s.unsaved)
  const currentPath = useApp((s) => s.currentPath)
  const syncNow = useApp((s) => s.syncNow)
  const isPhone = useIsPhone()

  return (
    <footer className="status">
      <button className={`status-sync ${sync}`} onClick={() => void syncNow()} title="Sync now">
        <span className="dot" />
        {label[sync]}
        {pending > 0 && <span className="pending">{pending} queued</span>}
      </button>
      {unsaved && <span className="muted">unsaved…</span>}
      <span className="spacer" />
      {!isPhone && (
        <>
          {currentPath && (
            <>
              <button className="ghost" onClick={onToggleLivePreview} title="Toggle live preview">
                {livePreview ? 'preview' : 'source'}
              </button>
              <button className="ghost" onClick={() => void promptRename(currentPath)}>
                rename
              </button>
              <button className="ghost danger" onClick={() => void promptDelete(currentPath)}>
                delete
              </button>
            </>
          )}
          <button className="ghost" onClick={() => void promptSignOut()}>
            sign out
          </button>
        </>
      )}
    </footer>
  )
}
