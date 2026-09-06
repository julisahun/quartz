import type { VaultSummary } from '../api/client'
import { useApp } from '../state/store'
import { isLocal } from '../state/vaults'
import { isDesktop } from '../vault/tauri-bridge'
import { FolderPlus } from './icons'

/**
 * Switches between the vaults this account can open — its own, plus any shared
 * ones it has been added to — and the folders opened from disk on this device.
 *
 * Hidden in a browser when there is only one, since most people will only ever
 * have theirs. The desktop always keeps the picker beside it: opening a folder
 * is how a machine with no account gets a vault at all.
 */
export function VaultSwitcher() {
  const vaults = useApp((s) => s.vaults)
  const currentVault = useApp((s) => s.currentVault)
  const selectVault = useApp((s) => s.selectVault)
  const openFolder = useApp((s) => s.openFolder)
  const user = useApp((s) => s.user)
  const desktop = isDesktop()

  if (vaults.length <= 1 && !desktop) return null

  const mine = vaults.filter((v): v is VaultSummary => v.kind === 'private')
  const shared = vaults.filter((v): v is VaultSummary => v.kind === 'shared')
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
                    {v.owner === user ? v.name : `${v.name} (${v.owner})`}
                  </option>
                ))}
              </optgroup>
            )}
            {shared.length > 0 && (
              <optgroup label="Shared">
                {shared.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.owner === user ? '' : ` · ${v.owner}`}
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
      {desktop && (
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
