import type { VaultStore } from '../vault/types'

/**
 * Storage on iOS is not a promise. Safari evicts site data from apps it thinks
 * are idle, which for a notes app means the vault silently disappearing
 * (plan section 5, milestone 6).
 *
 * Two defences: ask for persistent storage, and notice when eviction has
 * happened so the vault can be pulled down again rather than looking empty.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Detects eviction: the device has synced before (so it had files), yet the
 * local store is empty. Clears the sync bookkeeping so the next sync
 * reconciles against the full manifest instead of an empty journal tail.
 */
export async function detectEviction(store: VaultStore): Promise<boolean> {
  const bootstrapped = await store.flag('bootstrapped')
  if (!bootstrapped) return false
  const files = await store.list()
  if (files.length > 0) return false

  await store.setFlag('bootstrapped', '')
  await store.setCursor(0)
  return true
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  if (!navigator.storage?.estimate) return undefined
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return undefined
  }
}
