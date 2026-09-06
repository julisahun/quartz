import type { FolderBridge } from './folder-store'

interface TauriApi {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

/** True inside the Tauri shell, false in a browser tab. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function tauri(): TauriApi {
  const internals = (window as unknown as { __TAURI_INTERNALS__: TauriApi }).__TAURI_INTERNALS__
  if (!internals) throw new Error('not running inside the desktop shell')
  return internals
}

/** A folder opened from disk, as the shell records it. */
export interface LocalVaultEntry {
  id: string
  name: string
  path: string
  /** True once promoted: the id is the server's and the notes have not moved. */
  synced: boolean
}

/** The folders opened as vaults on this device. None, in a browser. */
export async function localVaults(): Promise<LocalVaultEntry[]> {
  if (!isDesktop()) return []
  return tauri().invoke<LocalVaultEntry[]>('local_vaults')
}

/**
 * Asks the shell for a folder and opens it as a vault. Undefined means the
 * picker was dismissed. The dialog belongs to the Rust side, so the webview is
 * never handed the filesystem — it asks for a vault and gets a vault.
 */
export async function pickLocalVault(): Promise<LocalVaultEntry | undefined> {
  return (await tauri().invoke<LocalVaultEntry | null>('pick_local_vault')) ?? undefined
}

/** Re-keys a promoted folder to the id its vault was given on the server. */
export async function promoteLocalVault(id: string, newId: string): Promise<LocalVaultEntry> {
  return tauri().invoke<LocalVaultEntry>('promote_local_vault', { id, newId })
}

/** Stops listing a folder. The folder and its notes stay where they are. */
export async function forgetLocalVault(id: string): Promise<void> {
  await tauri().invoke('forget_local_vault', { id })
}

/**
 * Bridges the storage seam to the Rust side for one vault. Every call is a
 * Tauri command; the Rust half owns path safety, hashing and atomic writes,
 * exactly as the server does for the vaults on the Pi.
 */
export function tauriBridge(vault: string): FolderBridge {
  return {
    list: () => tauri().invoke('vault_list', { vault }),
    read: async (path) => new Uint8Array(await tauri().invoke<number[]>('vault_read', { vault, path })),
    write: (path, data) => tauri().invoke('vault_write', { vault, path, data: Array.from(data) }),
    remove: (path) => tauri().invoke('vault_delete', { vault, path }),
    stateRead: () => tauri().invoke('state_read', { vault }),
    stateWrite: (json) => tauri().invoke('state_write', { vault, json }),
  }
}
