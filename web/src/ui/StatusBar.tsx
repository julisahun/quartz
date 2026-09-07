import { useApp, type SyncState } from '../state/store'
import {
  promptDelete,
  promptForgetFolder,
  promptPromote,
  promptRename,
  promptChangePassword,
  promptSignOut,
} from './actions'
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
  local: 'local folder',
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
  const currentVault = useApp((s) => s.currentVault)
  const isFolder = useApp((s) => s.vaults.some((v) => v.id === s.currentVault && v.kind === 'local'))
  const signedIn = useApp((s) => s.signedIn)
  const showLogin = useApp((s) => s.showLogin)
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
          {signedIn ? (
            <>
              <button className="ghost" onClick={() => void promptChangePassword()}>
                password…
              </button>
              <button className="ghost" onClick={() => void promptSignOut()}>
                sign out
              </button>
            </>
          ) : (
            // The way back to an account. Nothing else here leads to the login
            // screen once a folder from disk is open, and without an account
            // there is nothing to publish a folder to.
            <button className="ghost" onClick={() => showLogin(true)}>
              sign in
            </button>
          )}
        </>
      )}
    </footer>
  )
}
