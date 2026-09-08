import { useApp, type SyncState } from '../state/store'
import { isLocal } from '../state/vaults'
import { promptDelete, promptForgetFolder, promptPromote, promptRename } from './actions'
import { Gear } from './icons'
import { useIsPhone } from './media'
import { Slot } from './Slot'

interface Props {
  livePreview: boolean
  onToggleLivePreview: () => void
  onOpenSettings: () => void
}

const label: Record<SyncState, string> = {
  idle: 'synced',
  syncing: 'syncing…',
  offline: 'offline',
  'needs-login': 'signed out',
  error: 'sync failed',
  local: 'local folder',
}

/**
 * On a phone this is the sync light and the way into settings: everything else
 * moved into the overflow menus, where a target can be a finger wide. On a
 * desktop it stays the row of actions it has always been.
 *
 * The gear renders at both widths, and is the only thing here that does. It is
 * the way to the account, so it cannot be behind the `!isPhone` gate the rest
 * of these buttons are — and it sits beside the sync light rather than out at
 * the end, so it does not move as the actions beside a note come and go.
 */
export function StatusBar({ livePreview, onToggleLivePreview, onOpenSettings }: Props) {
  const sync = useApp((s) => s.sync)
  const pending = useApp((s) => s.pending)
  const unsaved = useApp((s) => s.unsaved)
  const currentPath = useApp((s) => s.currentPath)
  const currentVault = useApp((s) => s.currentVault)
  const isFolder = useApp((s) => s.vaults.some((v) => v.id === s.currentVault && isLocal(v)))
  const signedIn = useApp((s) => s.signedIn)
  const syncNow = useApp((s) => s.syncNow)
  const isPhone = useIsPhone()

  return (
    <footer className="status">
      <button
        className={`status-sync ${sync}`}
        onClick={() => void syncNow()}
        title={isFolder ? 'This folder lives on this machine only' : 'Sync now'}
      >
        <span className="dot" />
        {label[sync]}
        {pending > 0 && <span className="pending">{pending} queued</span>}
      </button>
      {unsaved && <span className="muted">unsaved…</span>}
      <Slot name="status.items" />
      <button
        className="icon-button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <Gear />
      </button>
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
          {isFolder && currentVault && (
            <>
              {signedIn && (
                <button className="ghost" onClick={() => void promptPromote(currentVault)}>
                  sync…
                </button>
              )}
              <button className="ghost" onClick={() => void promptForgetFolder(currentVault)}>
                forget folder
              </button>
            </>
          )}
        </>
      )}
    </footer>
  )
}
