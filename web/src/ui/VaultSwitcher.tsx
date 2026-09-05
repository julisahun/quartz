import { useApp } from '../state/store'

/**
 * Switches between the vaults this account can open: its own, plus any shared
 * ones it has been added to. Hidden when there is only one — most people will
 * only ever have theirs.
 */
export function VaultSwitcher() {
  const vaults = useApp((s) => s.vaults)
  const currentVault = useApp((s) => s.currentVault)
  const selectVault = useApp((s) => s.selectVault)
  const user = useApp((s) => s.user)

  if (vaults.length <= 1) return null

  const mine = vaults.filter((v) => v.kind === 'private')
  const shared = vaults.filter((v) => v.kind === 'shared')

  return (
    <label className="vault-switcher">
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
      </select>
    </label>
  )
}
