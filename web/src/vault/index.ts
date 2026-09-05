import { DesktopVaultStore } from './desktop-store'
import { IdbVaultStore } from './idb-store'
import { isDesktop, tauriBridge } from './tauri-bridge'
import type { VaultStore } from './types'

/**
 * Picks the implementation of the storage seam for wherever the app is
 * running, and gives each (account, vault) pair a store of its own — two
 * accounts on one browser must never share a local vault.
 */
export function createVaultStore(user: string, vaultId: string): VaultStore {
  if (isDesktop()) return new DesktopVaultStore(tauriBridge(vaultId))
  return new IdbVaultStore(`quartz-${user}-${vaultId}`)
}
