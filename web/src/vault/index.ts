import { DesktopVaultStore } from './desktop-store'
import { IdbVaultStore } from './idb-store'
import { isDesktop, tauriBridge } from './tauri-bridge'
import type { VaultStore } from './types'

/**
 * Picks the implementation of the storage seam for wherever the app is running.
 * This is the only place in the app that knows which one it is.
 */
export function createVaultStore(): VaultStore {
  return isDesktop() ? new DesktopVaultStore(tauriBridge) : new IdbVaultStore()
}
