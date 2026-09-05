import type { DesktopBridge } from './desktop-store'

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

/**
 * Bridges the storage seam to the Rust side for one vault. Every call is a
 * Tauri command; the Rust half owns path safety, hashing and atomic writes,
 * exactly as the server does for the vaults on the Pi.
 */
export function tauriBridge(vault: string): DesktopBridge {
  return {
    list: () => tauri().invoke('vault_list', { vault }),
    read: async (path) => new Uint8Array(await tauri().invoke<number[]>('vault_read', { vault, path })),
    write: (path, data) => tauri().invoke('vault_write', { vault, path, data: Array.from(data) }),
    remove: (path) => tauri().invoke('vault_delete', { vault, path }),
    stateRead: () => tauri().invoke('state_read', { vault }),
    stateWrite: (json) => tauri().invoke('state_write', { vault, json }),
  }
}
