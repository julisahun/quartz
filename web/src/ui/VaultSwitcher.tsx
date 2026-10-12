import type { VaultSummary } from '../api/client'
import { useApp } from '../state/store'
import { isLocal } from '../state/vaults'
import { foldersSupported } from '../vault/folders'
import { Ellipsis, FolderPlus } from './icons'

/**
 * Switches between the vaults this account can open — its own, plus any shared
 * ones it has been added to — and the folders opened from disk on this device.
 *
 * With only one vault there is nothing to switch to, so its name is shown
 * instead of a picker. Where folders are possible the button to open one stays
 * beside it whatever the list looks like: opening one is how a machine with no
 * account gets a vault at all. The ⋯ is the same vault menu the phone has.
 */
export function VaultSwitcher({ onMenu }: { onMenu: () => void }) {
  const vaults = useApp((s) => s.vaults)
  const currentVault = useApp((s) => s.currentVault)
  const selectVault = useApp((s) => s.selectVault)
  const openFolder = useApp((s) => s.openFolder)
  const user = useApp((s) => s.user)
  const canOpenFolders = foldersSupported()

  const only = vaults.length === 1 ? vaults[0] : undefined

  // Grouped by who owns a vault. Every vault is one thing now — a directory
  // with a membership list — so ownership is the only distinction left, and it
  // is the one that was doing the work here anyway.
  const server = vaults.filter((v): v is VaultSummary => !isLocal(v))
  const mine = server.filter((v) => v.owner === user)
  const shared = server.filter((v) => v.owner !== user)
  const folders = vaults.filter(isLocal)

  return (
    <div className="vault-switcher">
      {only ? (
        <span className="vault-name" title={isLocal(only) ? only.path : undefined}>
          {only.name}
        </span>
      ) : vaults.length > 1 && (
        <label>
          <span className="visually-hidden">Vault</span>
          <select value={currentVault ?? ''} onChange={(e) => void selectVault(e.target.value)}>
            {mine.length > 0 && (
              <optgroup label="Yours">
                {mine.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
            {shared.length > 0 && (
              <optgroup label="Shared">
                {shared.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.owner}
                  </option>
                ))}
              </optgroup>
            )}
            {folders.length > 0 && (
              <optgroup label="On this device">
                {folders.map((v) => (
                  <option key={v.id} value={v.id} title={v.path}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}
      {canOpenFolders && (
        <button
          className="icon-button"
          onClick={() => void openFolder()}
          title="Open a vault from this machine"
          aria-label="Open a vault from this machine"
        >
          <FolderPlus />
        </button>
      )}
      <button className="icon-button" onClick={onMenu} aria-label="Vault actions" title="Vault actions">
        <Ellipsis />
      </button>
    </div>
  )
}
