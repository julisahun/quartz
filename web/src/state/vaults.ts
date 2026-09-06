import type { VaultSummary } from '../api/client'

/**
 * A folder opened from disk. It belongs to no account, syncs with nothing, and
 * exists only on the device that opened it — the folder is the whole of it.
 *
 * That is what makes the app usable with no server at all: the Pi being down,
 * or never having existed, is not a reason to be locked out of your own notes.
 */
export interface LocalVaultSummary {
  id: string
  name: string
  kind: 'local'
  /** Where it sits on this machine, for telling two folders of one name apart. */
  path: string
}

/** Either kind of vault, as the app lists them side by side. */
export type Vault = VaultSummary | LocalVaultSummary

export function isLocal(vault: Vault): vault is LocalVaultSummary {
  return vault.kind === 'local'
}

/**
 * The account's vaults first, then the folders opened on this device.
 *
 * An id is the key to a vault's store, its runtime and its sync state, so two
 * vaults may never share one. A local folder therefore gives way to a server
 * vault of the same id rather than shadowing it — losing a row from the
 * switcher is recoverable, two stores writing one folder is not.
 */
export function mergeVaults(server: VaultSummary[], local: LocalVaultSummary[]): Vault[] {
  const taken = new Set(server.map((v) => v.id))
  return [...server, ...local.filter((v) => !taken.has(v.id))]
}

/**
 * Which vault to open: the one last used, else the account's own, else
 * whatever is there — which on a machine with no account is a folder.
 */
export function chooseVault(vaults: Vault[], user: string, last?: string): string | undefined {
  if (last && vaults.some((v) => v.id === last)) return last
  const own = vaults.find((v) => v.kind === 'private' && v.owner === user)
  return (own ?? vaults[0])?.id
}

/** How a vault describes itself in a menu, under its name. */
export function vaultHint(vault: Vault, user: string): string {
  if (isLocal(vault)) return 'on this device'
  if (vault.kind === 'shared') return vault.owner === user ? 'shared' : `shared · ${vault.owner}`
  return 'private'
}
