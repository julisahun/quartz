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
  /**
   * Where it sits on this machine, for telling two folders of one name apart.
   * Absent in a browser, which is never told where a folder actually is.
   */
  path?: string
}

/** Either kind of vault, as the app lists them side by side. */
export type Vault = VaultSummary | LocalVaultSummary

export function isLocal(vault: Vault): vault is LocalVaultSummary {
  // A server vault has no `kind` at all: the field exists only to mark the
  // folders this device opened for itself.
  return 'kind' in vault && vault.kind === 'local'
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
 * Which vault to open: the one last used, else one the account owns, else
 * whatever is there — which on a machine with no account is a folder.
 *
 * There is no longer a vault the account was *given*, so "your own" is just
 * ownership; among several the first is as good a guess as any, because the
 * last-used id covers every case anybody actually notices.
 */
export function chooseVault(vaults: Vault[], user: string, last?: string): string | undefined {
  if (last && vaults.some((v) => v.id === last)) return last
  const own = vaults.find((v) => !isLocal(v) && v.owner === user)
  return (own ?? vaults[0])?.id
}

/**
 * The id a promoted vault takes, from the name the user gave it.
 *
 * The server accepts letters, digits, dots, dashes and underscores, and the id
 * becomes a path segment in the API and a directory name on the Pi — so this
 * has to produce something that survives both, or the promotion is refused for
 * a reason nobody typed.
 */
export function slugForVault(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // é → e, so an accent is not a dash
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    // A single separator is kept as it was typed; a pile of them becomes one
    // dash, so "notes/../escape" reads as "notes-escape" and not as a path
    // someone tried to write.
    .replace(/[-.]{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 64)
  return slug
}

/** How a vault describes itself in a menu, under its name. */
export function vaultHint(vault: Vault, user: string): string {
  if (isLocal(vault)) return 'on this device'
  if (vault.owner === user) return 'yours'
  return `shared · ${vault.owner}`
}
