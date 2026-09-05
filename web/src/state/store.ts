import { create } from 'zustand'
import { ApiError, HttpApi, OfflineError, type SearchHit, type VaultSummary } from '../api/client'
import { SyncEngine, type SyncNotice } from '../sync/engine'
import { createVaultStore } from '../vault'
import { isDesktop } from '../vault/tauri-bridge'
import { decodeText, encodeText, type FileMeta, type VaultStore } from '../vault/types'
import { isNote, noteTitle, pathForTitle, uniquePath } from './notes'
import { persisted } from './persist'
import { detectEviction, requestPersistence } from './storage'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'needs-login' | 'error'

export interface Notice {
  id: number
  kind: SyncNotice['kind'] | 'info' | 'error'
  text: string
}

const SAVE_DEBOUNCE_MS = 500
const SYNC_AFTER_SAVE_MS = 1500
const SYNC_INTERVAL_MS = 30_000

const desktop = isDesktop()
// On the desktop the API base is absolute: the shell serves the app from its
// own origin, so it has to be told where the server is.
const apiBase = desktop ? (localStorage.getItem('serverUrl') ?? 'https://notes.sigint-pm.uk') : ''
const api = new HttpApi(apiBase, desktop ? persisted.token() : undefined, (token) =>
  persisted.setToken(token),
)

/** One vault's local half: where its files live and what syncs them. */
interface Runtime {
  store: VaultStore
  engine: SyncEngine
}

const runtimes = new Map<string, Runtime>()
let saveTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncing = false
let syncAgain = false
let noticeId = 0

interface AppState {
  phase: 'loading' | 'login' | 'ready'
  user: string
  device: string
  vaults: VaultSummary[]
  currentVault: string | undefined
  files: FileMeta[]
  currentPath: string | undefined
  content: string
  unsaved: boolean
  pending: number
  sync: SyncState
  lastSyncedAt: number
  notices: Notice[]

  boot(): Promise<void>
  login(user: string, password: string): Promise<void>
  logout(): Promise<void>
  selectVault(id: string): Promise<void>
  open(path: string): Promise<void>
  edit(text: string): void
  save(): Promise<void>
  createNote(title: string, folder?: string): Promise<string>
  deleteNote(path: string): Promise<void>
  renameNote(from: string, to: string): Promise<string>
  attach(file: File): Promise<string>
  blobUrl(path: string): Promise<string | undefined>
  syncNow(): Promise<void>
  search(query: string): Promise<SearchHit[]>
  dismissNotice(id: number): void
}

export const useApp = create<AppState>()((set, get) => {
  const notice = (kind: Notice['kind'], text: string) => {
    set((s) => ({ notices: [...s.notices, { id: ++noticeId, kind, text }] }))
  }

  /** The local half of a vault, created the first time it is needed. */
  const runtimeFor = (vaultId: string): Runtime => {
    const { user, device } = get()
    const key = `${user}/${vaultId}`
    const existing = runtimes.get(key)
    if (existing) return existing

    const store = createVaultStore(user, vaultId)
    const engine = new SyncEngine(store, api.vault(vaultId), {
      device,
      onNotice: (n) => {
        const where = get().vaults.find((v) => v.id === vaultId)?.name ?? vaultId
        if (n.kind === 'conflict') {
          notice('conflict', `Both versions of ${n.path} kept in ${where} — the other is in ${n.detail}`)
        } else if (n.kind === 'restored') {
          notice('restored', `${n.path} came back: it was edited elsewhere`)
        } else {
          notice('reset', `${where} was re-checked against the server`)
        }
      },
    })
    const runtime = { store, engine }
    runtimes.set(key, runtime)
    return runtime
  }

  const current = (): Runtime | undefined => {
    const id = get().currentVault
    return id ? runtimeFor(id) : undefined
  }

  const refreshFiles = async () => {
    const runtime = current()
    if (!runtime) {
      set({ files: [], pending: 0 })
      return
    }
    const files = await runtime.store.list()
    const pending = (await runtime.store.pending()).length
    set({ files, pending })
  }

  const openFirstNote = async () => {
    if (get().currentPath) return
    const first = get().files.find((f) => isNote(f.path))
    if (first) await get().open(first.path)
  }

  const scheduleSync = (delay = SYNC_AFTER_SAVE_MS) => {
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => void get().syncNow(), delay)
  }

  /** Picks which vault to open: the last one used, else the user's own. */
  const pickVault = (vaults: VaultSummary[], user: string): string | undefined => {
    const last = persisted.lastVault()
    if (last && vaults.some((v) => v.id === last)) return last
    return (vaults.find((v) => v.kind === 'private' && v.owner === user) ?? vaults[0])?.id
  }

  const adoptIdentity = async (user: string, vaults: VaultSummary[]) => {
    persisted.setUser(user)
    persisted.setVaults(vaults)
    set({ user, vaults })
    const chosen = pickVault(vaults, user)
    if (chosen) await get().selectVault(chosen)
  }

  return {
    phase: 'loading',
    user: '',
    device: '',
    vaults: [],
    currentVault: undefined,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    pending: 0,
    sync: 'idle',
    lastSyncedAt: 0,
    notices: [],

    async boot() {
      const device = persisted.device()
      const cachedUser = persisted.user() ?? ''
      const cachedVaults = persisted.vaults()
      set({ device, user: cachedUser, vaults: cachedVaults })
      if (!desktop) void requestPersistence()

      // An offline launch must never bounce you to a login you cannot reach:
      // with a vault cached locally, go straight in and sort the session out
      // afterwards.
      const hasLocalVault = cachedUser !== '' && cachedVaults.length > 0
      if (hasLocalVault) {
        set({ phase: 'ready' })
        const chosen = pickVault(cachedVaults, cachedUser)
        if (chosen) await get().selectVault(chosen)
      }

      let identity
      try {
        identity = await api.session()
      } catch {
        // The server is unreachable. With a local vault that is not an error:
        // read and write offline, and sync when the network comes back.
        set({ sync: 'offline', phase: hasLocalVault ? 'ready' : 'login' })
        return
      }
      if (!identity) {
        set(hasLocalVault ? { sync: 'needs-login' } : { phase: 'login' })
        return
      }
      set({ phase: 'ready' })
      await adoptIdentity(identity.user, identity.vaults)
      await get().syncNow()
      await openFirstNote()
    },

    async login(user, password) {
      const identity = await api.login(user, password, get().device, desktop)
      set({ phase: 'ready', sync: 'idle' })
      await adoptIdentity(identity.user, identity.vaults)
      await get().syncNow()
      await openFirstNote()
    },

    async logout() {
      // Deliberately keeps the local vaults: signing out is not "forget my notes".
      try {
        await api.logout()
      } catch {
        /* offline is fine; the cookie dies with the session anyway */
      }
      persisted.clearIdentity()
      runtimes.clear()
      set({
        phase: 'login',
        sync: 'idle',
        vaults: [],
        currentVault: undefined,
        files: [],
        currentPath: undefined,
        content: '',
      })
    },

    async selectVault(id) {
      if (get().unsaved) await get().save()
      if (get().currentVault === id) return
      persisted.setLastVault(id)
      set({ currentVault: id, currentPath: undefined, content: '', unsaved: false })

      const runtime = runtimeFor(id)
      if (await detectEviction(runtime.store)) {
        notice('info', 'This device had been cleared by the browser. Re-downloading your notes…')
      }
      await refreshFiles()
      await openFirstNote()
      scheduleSync(0)
    },

    async open(path) {
      const runtime = current()
      if (!runtime) return
      if (get().unsaved) await get().save()
      try {
        const data = await runtime.store.read(path)
        set({ currentPath: path, content: decodeText(data), unsaved: false })
      } catch {
        notice('error', `${path} is not stored on this device yet`)
      }
    },

    edit(text) {
      set({ content: text, unsaved: true })
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void get().save(), SAVE_DEBOUNCE_MS)
    },

    async save() {
      const { currentPath, content, unsaved } = get()
      const runtime = current()
      if (!runtime || !currentPath || !unsaved) return
      if (saveTimer) clearTimeout(saveTimer)
      await runtime.store.write(currentPath, encodeText(content))
      set({ unsaved: false })
      await refreshFiles()
      scheduleSync()
    },

    async createNote(title, folder = '') {
      const runtime = current()
      if (!runtime) throw new Error('no vault is open')
      const path = uniquePath(pathForTitle(title, folder), get().files)
      await runtime.store.write(path, encodeText(`# ${noteTitle(path)}\n\n`))
      await refreshFiles()
      await get().open(path)
      scheduleSync()
      return path
    },

    async deleteNote(path) {
      const runtime = current()
      if (!runtime) return
      await runtime.store.delete(path)
      if (get().currentPath === path) {
        set({ currentPath: undefined, content: '', unsaved: false })
      }
      await refreshFiles()
      scheduleSync()
    },

    async renameNote(from, to) {
      const runtime = current()
      if (!runtime) throw new Error('no vault is open')
      const target = uniquePath(to, get().files)
      const data = await runtime.store.read(from)
      await runtime.store.write(target, data)
      await runtime.store.delete(from)
      await refreshFiles()
      if (get().currentPath === from) await get().open(target)
      scheduleSync()
      return target
    },

    async attach(file) {
      const runtime = current()
      if (!runtime) throw new Error('no vault is open')
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '-')
      const path = uniquePath(`attachments/${stamp}-${safe}`, get().files)
      await runtime.store.write(path, new Uint8Array(await file.arrayBuffer()))
      await refreshFiles()
      scheduleSync()
      return path
    },

    async blobUrl(path) {
      const runtime = current()
      if (!runtime) return undefined
      try {
        const data = await runtime.store.read(path)
        return URL.createObjectURL(new Blob([data as BlobPart]))
      } catch {
        return undefined
      }
    },

    async syncNow() {
      const { currentVault, vaults } = get()
      if (!currentVault) return
      if (syncing) {
        syncAgain = true
        return
      }
      syncing = true
      set({ sync: 'syncing' })
      try {
        // The open vault first, so what you are looking at is current soonest;
        // the others follow so a switch is instant.
        const stats = await runtimeFor(currentVault).engine.sync()
        set({ sync: 'idle', lastSyncedAt: Date.now() })
        await refreshFiles()

        // If the open note changed underneath us, show the new bytes — but
        // never over unsaved typing.
        const { currentPath, unsaved } = get()
        if (currentPath && !unsaved && stats.pulled + stats.conflicts > 0) {
          const runtime = runtimeFor(currentVault)
          const meta = await runtime.store.meta(currentPath)
          if (!meta) {
            set({ currentPath: undefined, content: '' })
          } else {
            const text = decodeText(await runtime.store.read(currentPath))
            if (text !== get().content) set({ content: text })
          }
        }

        for (const vault of vaults) {
          if (vault.id === currentVault) continue
          try {
            await runtimeFor(vault.id).engine.sync()
          } catch (err) {
            if (err instanceof OfflineError) break
            if (err instanceof ApiError && err.isAuth) break
            // One vault failing must not stop the others.
            console.warn(`syncing ${vault.id} failed`, err)
          }
        }
      } catch (err) {
        if (err instanceof OfflineError) {
          set({ sync: 'offline' })
        } else if (err instanceof ApiError && err.isAuth) {
          // Pending work is untouched; the user just has to sign in again.
          set({ sync: 'needs-login' })
        } else {
          set({ sync: 'error' })
          notice('error', err instanceof Error ? err.message : 'sync failed')
        }
      } finally {
        syncing = false
        if (syncAgain) {
          syncAgain = false
          scheduleSync(0)
        }
      }
    },

    async search(query) {
      const q = query.trim()
      const vaultId = get().currentVault
      if (!q || !vaultId) return []
      try {
        return await api.vault(vaultId).search(q)
      } catch {
        return localSearch(q, get().files, runtimeFor(vaultId).store)
      }
    },

    dismissNotice(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
    },
  }
})

/** Offline fallback for search: a substring scan of the local notes. */
async function localSearch(
  query: string,
  files: FileMeta[],
  store: VaultStore,
): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  const hits: SearchHit[] = []
  for (const file of files) {
    if (!isNote(file.path)) continue
    let text: string
    try {
      text = decodeText(await store.read(file.path))
    } catch {
      continue
    }
    const at = text.toLowerCase().indexOf(needle)
    const title = noteTitle(file.path)
    if (at === -1 && !title.toLowerCase().includes(needle)) continue
    const from = Math.max(0, at - 40)
    hits.push({
      path: file.path,
      title,
      snippet: at === -1 ? text.slice(0, 80) : `…${text.slice(from, at + needle.length + 60)}…`,
    })
    if (hits.length >= 50) break
  }
  return hits
}

/** Keeps the vaults moving without the user asking: interval, focus, reconnect. */
export function startBackgroundSync(): () => void {
  const tick = () => {
    const { phase, sync } = useApp.getState()
    if (phase === 'ready' && sync !== 'syncing') void useApp.getState().syncNow()
  }
  const interval = setInterval(tick, SYNC_INTERVAL_MS)
  const onVisible = () => {
    if (document.visibilityState === 'visible') tick()
  }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onVisible)
  // A last save before the tab goes away; the pending queue survives regardless.
  const onHide = () => void useApp.getState().save()
  window.addEventListener('pagehide', onHide)

  return () => {
    clearInterval(interval)
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pagehide', onHide)
  }
}
