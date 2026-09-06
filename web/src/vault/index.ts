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
 * A vault opened from disk is a real folder whichever side of the seam it is
 * reached from, so it gets the same store either way; only the bridge under it
 * differs. Everything synced is IndexedDB in a browser, since the server's
 * copy is the one that matters and a tab has nowhere else to put it.
 */
export function createVaultStore(user: string, vaultId: string, local = false): VaultStore {
  if (isDesktop()) return new FolderVaultStore(tauriBridge(vaultId))
  if (local) return new FolderVaultStore(fsaBridge(vaultId))
  return new IdbVaultStore(`quartz-${user}-${vaultId}`)
}
