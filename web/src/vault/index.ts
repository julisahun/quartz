import { FolderVaultStore } from './folder-store'
import { fsaBridge } from './fsa-bridge'
import { IdbVaultStore } from './idb-store'
import { isDesktop, tauriBridge } from './tauri-bridge'
import type { VaultStore } from './types'

/**
 * Picks the implementation of the storage seam for wherever the app is
 * running, and gives each (account, vault) pair a store of its own — two
 * accounts on one browser must never share a local vault.
 *
 * Whether a vault's bytes live in a folder is a fact about the vault on this
 * device, not about the platform: the shell can hold some vaults as folders
 * and keep others in its own storage, exactly as a browser does. Only the
 * bridge under a folder differs between the two.
 */
export function createVaultStore(user: string, vaultId: string, folder = false): VaultStore {
  if (folder) return new FolderVaultStore(isDesktop() ? tauriBridge(vaultId) : fsaBridge(vaultId))
  return new IdbVaultStore(`quartz-${user}-${vaultId}`)
}
