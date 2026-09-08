import type { VaultSummary } from '../api/client'

/**
 * The little bits of state that belong to this browser rather than to any one
 * vault: who is signed in, what this device is called, which vault was last
 * open, and (desktop only) the session token.
 *
 * Kept in localStorage because a vault's own IndexedDB is the wrong home for
 * something shared across vaults — and because it must be readable before any
 * vault has been opened.
 */
const KEYS = {
  user: 'quartz.user',
  device: 'quartz.device',
  vaults: 'quartz.vaults',
  lastVault: 'quartz.lastVault',
  token: 'quartz.token',
  collapsed: 'quartz.collapsed',
  sidebarWidth: 'quartz.sidebarWidth',
  // Unprefixed, because the desktop shell has been reading it under this name
  // since before there was any way to set it. Renaming it would point existing
  // installs at the default server.
  serverUrl: 'serverUrl',
} as const

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined
  } catch {
    return undefined // private mode, or storage disabled
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing here is worth failing over */
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* nothing here is worth failing a sync over */
  }
}

export const persisted = {
  user: () => read(KEYS.user),
  setUser: (user: string) => write(KEYS.user, user),

  token: () => read(KEYS.token),
  setToken: (token: string) => write(KEYS.token, token),

  lastVault: () => read(KEYS.lastVault),
  setLastVault: (id: string) => write(KEYS.lastVault, id),

  /**
   * The vault list is cached so an offline launch can show the switcher and
   * open the right local vault without asking the server first.
   */
  vaults(): VaultSummary[] {
    const raw = read(KEYS.vaults)
    if (!raw) return []
    try {
      return JSON.parse(raw) as VaultSummary[]
    } catch {
      return []
    }
  },
  setVaults: (vaults: VaultSummary[]) => write(KEYS.vaults, JSON.stringify(vaults)),

  /**
   * Which folders are closed in a vault's sidebar. Folders are open until
   * someone closes one, so it is the closing that is worth remembering — and
   * per vault, since a folder tree belongs to the vault it is in.
   */
  collapsed(vault: string): string[] {
    const raw = read(`${KEYS.collapsed}.${vault}`)
    if (!raw) return []
    try {
      const paths: unknown = JSON.parse(raw)
      return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    } catch {
      return []
    }
  },
  setCollapsed: (vault: string, paths: string[]) =>
    write(`${KEYS.collapsed}.${vault}`, JSON.stringify(paths)),

  /**
   * How wide the note list has been dragged, in pixels. A property of this
   * screen rather than of any vault, so it is not stored per vault — and it
   * survives signing out, which does not change how wide a window is.
   */
  sidebarWidth(): number | undefined {
    const px = Number(read(KEYS.sidebarWidth))
    return Number.isFinite(px) && px > 0 ? px : undefined
  },
  setSidebarWidth: (px: number) => write(KEYS.sidebarWidth, String(px)),

  /**
   * Which server the desktop shell talks to.
   *
   * Only the desktop build has one to choose: the PWA is served by the server
   * it syncs with, so its API is same-origin and there is nothing to point
   * anywhere. Read once at start-up, so a change here lands on the next launch.
   */
  serverUrl: () => read(KEYS.serverUrl),
  setServerUrl: (url: string) => write(KEYS.serverUrl, url),

  /**
   * Forgets who was signed in, without touching the vaults themselves: the
   * notes stay in local storage for the next sign-in, but a deliberate sign-out
   * does return you to the login screen.
   */
  clearIdentity(): void {
    remove(KEYS.user)
    remove(KEYS.vaults)
    remove(KEYS.lastVault)
    remove(KEYS.token)
  },

  /**
   * A stable, human-readable name for this device. It ends up inside conflict
   * file names, so "iphone" is worth having over a random id — with a suffix
   * to tell two browsers on one machine apart.
   */
  device(): string {
    const existing = read(KEYS.device)
    if (existing) return existing

    const ua = navigator.userAgent
    let kind = 'browser'
    if (/iPhone/i.test(ua)) kind = 'iphone'
    else if (/iPad/i.test(ua)) kind = 'ipad'
    else if (/Android/i.test(ua)) kind = 'android'
    else if (/Macintosh/i.test(ua)) kind = 'mac'
    else if (/Windows/i.test(ua)) kind = 'windows'
    else if (/Linux/i.test(ua)) kind = 'linux'

    const name = `${kind}-${Math.random().toString(16).slice(2, 6)}`
    write(KEYS.device, name)
    return name
  },

  /**
   * Renames this device.
   *
   * Worth offering because the generated name is not only bookkeeping — it is
   * in the middle of every conflict copy's filename, where it is read by a
   * person deciding which of two versions to keep. Old conflict files keep the
   * name they were written with; nothing rewrites history.
   */
  setDevice: (name: string) => write(KEYS.device, name),
}
