import type { VaultSummary } from '../api/client'
import { useApp } from '../state/store'
import { isLocal } from '../state/vaults'
import { foldersSupported } from '../vault/folders'
import { FolderPlus } from './icons'

/**
 * Switches between the vaults this account can open — its own, plus any shared
 * ones it has been added to — and the folders opened from disk on this device.
 *
 * Hidden when there is only one and no folder can be opened, since most people
 * will only ever have theirs. Where folders are possible the picker stays
 * beside it whatever the list looks like: opening one is how a machine with no
 * account gets a vault at all.
 */
export function VaultSwitcher() {
  const vaults = useApp((s) => s.vaults)
  const currentVault = useApp((s) => s.currentVault)
  const selectVault = useApp((s) => s.selectVault)
  const openFolder = useApp((s) => s.openFolder)
  const user = useApp((s) => s.user)
  const canOpenFolders = foldersSupported()

  if (vaults.length <= 1 && !canOpenFolders) return null

  // Grouped by who owns a vault. Every vault is one thing now — a directory
  // with a membership list — so ownership is the only distinction left, and it
  // is the one that was doing the work here anyway.
  const server = vaults.filter((v): v is VaultSummary => !isLocal(v))
  const mine = server.filter((v) => v.owner === user)
  const shared = server.filter((v) => v.owner !== user)
  const folders = vaults.filter(isLocal)

  return (
    <div className="vault-switcher">
      {vaults.length > 0 && (
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
          title="Open a folder as a vault"
          aria-label="Open a folder as a vault"
        >
          <FolderPlus />
        </button>
      )}
    </div>
  )
}
