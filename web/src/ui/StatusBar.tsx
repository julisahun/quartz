import { useApp, type SyncState } from '../state/store'
import { isLocal } from '../state/vaults'
import { Gear } from './icons'
import { Slot } from './Slot'

interface Props {
  onOpenSettings: () => void
}

const label: Record<SyncState, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline',
  'needs-login': 'Signed out',
  error: 'Sync failed',
  local: 'Local folder',
}

/**
 * The bottom strip says how things are, and does not act on the note: the
 * sync light, what is queued or unsaved, whatever plugins add, and the way
 * into settings. Rename, delete and the rest live beside the note they act on
 * — in its header on a desktop, behind its ⋯ on a phone — and the vault's
 * actions behind the vault's own ⋯.
 *
 * The gear sits beside the sync light rather than out at the end, so it does
 * not move as plugin items come and go.
 */
export function StatusBar({ onOpenSettings }: Props) {
  const sync = useApp((s) => s.sync)
  const pending = useApp((s) => s.pending)
  const unsaved = useApp((s) => s.unsaved)
  const isFolder = useApp((s) => s.vaults.some((v) => v.id === s.currentVault && isLocal(v)))
  const syncNow = useApp((s) => s.syncNow)

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
      {unsaved && <span className="muted">Unsaved…</span>}
      <button className="icon-button" onClick={onOpenSettings} aria-label="Settings" title="Settings">
        <Gear />
      </button>
      <span className="spacer" />
      <Slot name="status.items" />
    </footer>
  )
}
