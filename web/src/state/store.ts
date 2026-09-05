import { create } from 'zustand'
import { ApiError, HttpApi, OfflineError, type SearchHit } from '../api/client'
import { SyncEngine, type SyncNotice } from '../sync/engine'
import { createVaultStore } from '../vault'
import { isDesktop } from '../vault/tauri-bridge'
import { decodeText, encodeText, type FileMeta } from '../vault/types'
import { deviceName } from './device'
import { detectEviction, requestPersistence } from './storage'
import { isNote, noteTitle, pathForTitle, uniquePath } from './notes'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'needs-login' | 'error'

export interface Notice {
  id: number
  kind: SyncNotice['kind'] | 'info' | 'error'
  text: string
}

const SAVE_DEBOUNCE_MS = 500
const SYNC_AFTER_SAVE_MS = 1500
const SYNC_INTERVAL_MS = 30_000

const store = createVaultStore()
const desktop = isDesktop()
// On the desktop the API base is absolute: the shell serves the app from its
// own origin, so it has to be told where the Pi is.
const apiBase = desktop ? (localStorage.getItem('serverUrl') ?? 'https://notes.sigint-pm.uk') : ''
const api = new HttpApi(apiBase, undefined, (token) => void store.setFlag('token', token))

let engine: SyncEngine | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncing = false
let syncAgain = false
let noticeId = 0

interface AppState {
  phase: 'loading' | 'login' | 'ready'
  user: string
  device: string
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

  const refreshFiles = async () => {
    const files = await store.list()
    const pending = (await store.pending()).length
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

  return {
    phase: 'loading',
    user: '',
    device: '',
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    pending: 0,
    sync: 'idle',
    lastSyncedAt: 0,
    notices: [],

    async boot() {
      const device = await deviceName(store)
      if (desktop) api.setToken(await store.flag('token'))
      else void requestPersistence()
      engine = new SyncEngine(store, api, {
        device,
        onNotice: (n) => {
          if (n.kind === 'conflict') {
            notice('conflict', `Both versions of ${n.path} kept — the other one is in ${n.detail}`)
          } else if (n.kind === 'restored') {
            notice('restored', `${n.path} came back: it was edited elsewhere`)
          } else {
            notice('reset', 'The server rebuilt its index; everything was re-checked')
          }
        },
      })
      if (await detectEviction(store)) {
        notice('info', 'This device had been cleared by the browser. Re-downloading your notes…')
      }
      await refreshFiles()

      // An offline launch must never bounce you to a login you cannot reach:
      // if a local vault exists, go straight in and sort the session out later.
      const hasLocalVault = get().files.length > 0 || !!(await store.flag('bootstrapped'))
      set({ device, user: (await store.flag('user')) ?? '', phase: hasLocalVault ? 'ready' : 'login' })

      try {
        const signedIn = await api.session()
        if (!signedIn) {
          set(hasLocalVault ? { sync: 'needs-login' } : { phase: 'login' })
          return
        }
      } catch {
        // The server is unreachable. With a local vault that is not an error:
        // read and write offline, and sync when the network comes back.
        set({ sync: 'offline' })
        await openFirstNote()
        return
      }
      await get().syncNow()
      await openFirstNote()
    },

    async login(user, password) {
      await api.login(user, password, get().device, desktop)
      await store.setFlag('user', user)
      set({ user, phase: 'ready', sync: 'idle' })
      await get().syncNow()
      await openFirstNote()
    },

    async logout() {
      // Deliberately keeps the local vault: signing out is not "forget my notes".
      try {
        await api.logout()
      } catch {
        /* offline is fine; the cookie dies with the session anyway */
      }
      set({ phase: 'login', sync: 'idle' })
    },

    async open(path) {
      if (get().unsaved) await get().save()
      try {
        const data = await store.read(path)
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
      if (!currentPath || !unsaved) return
      if (saveTimer) clearTimeout(saveTimer)
      await store.write(currentPath, encodeText(content))
      set({ unsaved: false })
      await refreshFiles()
      scheduleSync()
    },

    async createNote(title, folder = '') {
      const path = uniquePath(pathForTitle(title, folder), get().files)
      await store.write(path, encodeText(`# ${noteTitle(path)}\n\n`))
      await refreshFiles()
      await get().open(path)
      scheduleSync()
      return path
    },

    async deleteNote(path) {
      await store.delete(path)
      if (get().currentPath === path) {
        set({ currentPath: undefined, content: '', unsaved: false })
      }
      await refreshFiles()
      scheduleSync()
    },

    async renameNote(from, to) {
      const target = uniquePath(to, get().files)
      const data = await store.read(from)
      await store.write(target, data)
      await store.delete(from)
      await refreshFiles()
      if (get().currentPath === from) await get().open(target)
      scheduleSync()
      return target
    },

    async attach(file) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const safe = file.name.replace(/[^A-Za-z0-9._-]/g, '-')
      const path = uniquePath(`attachments/${stamp}-${safe}`, get().files)
      await store.write(path, new Uint8Array(await file.arrayBuffer()))
      await refreshFiles()
      scheduleSync()
      return path
    },

    async blobUrl(path) {
      try {
        const data = await store.read(path)
        return URL.createObjectURL(new Blob([data as BlobPart]))
      } catch {
        return undefined
      }
    },

    async syncNow() {
      if (!engine) return
      if (syncing) {
        syncAgain = true
        return
      }
      syncing = true
      set({ sync: 'syncing' })
      try {
        const stats = await engine.sync()
        set({ sync: 'idle', lastSyncedAt: Date.now() })
        await refreshFiles()

        // If the open note changed underneath us, show the new bytes — but
        // never over unsaved typing.
        const { currentPath, unsaved } = get()
        if (currentPath && !unsaved && stats.pulled + stats.conflicts > 0) {
          const meta = await store.meta(currentPath)
          if (!meta) {
            set({ currentPath: undefined, content: '' })
          } else {
            const text = decodeText(await store.read(currentPath))
            if (text !== get().content) set({ content: text })
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
      if (!q) return []
      try {
        return await api.search(q)
      } catch {
        return localSearch(q, get().files)
      }
    },

    dismissNotice(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
    },
  }
})

/** Offline fallback for search: a substring scan of the local notes. */
async function localSearch(query: string, files: FileMeta[]): Promise<SearchHit[]> {
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

/** Keeps the vault moving without the user asking: interval, focus, reconnect. */
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

export { store as vaultStore }
