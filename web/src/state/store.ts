import { create } from 'zustand'
import { ApiError, HttpApi, OfflineError, type SearchHit, type VaultSummary } from '../api/client'
import { SyncEngine, type SyncNotice } from '../sync/engine'
import { createVaultStore } from '../vault'
import {
  accessGranted,
  ensureAccess,
  forgetFolder as forgetFolderOnDisk,
  isFolderBacked,
  listFolders,
  pickFolder,
  cloneToFolder,
  keepInApp,
  promoteFolder,
  vaultMode,
} from '../vault/folders'
import { isDesktop } from '../vault/tauri-bridge'
import { decodeText, encodeText, type FileMeta, type VaultStore } from '../vault/types'
import { retargetLinks, type Backlink } from './links'
import { buildResolver, isNote, mimeType, noteTitle, pathForTitle, uniquePath } from './notes'
import { persisted } from './persist'
import { detectEviction, requestPersistence } from './storage'
import { sameBacklinks, sameTags, VaultIndex, type TagSummary } from './vault-index'
import {
  chooseVault,
  isLocal,
  mergeVaults,
  slugForVault,
  type LocalVaultSummary,
  type Vault,
} from './vaults'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'needs-login' | 'error' | 'local'

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

/** One vault's local half: where its files live, what syncs them, what links to what. */
interface Runtime {
  store: VaultStore
  /** Absent for a folder opened from disk: there is nothing to sync it with. */
  engine?: SyncEngine
  index: VaultIndex
}

const runtimes = new Map<string, Runtime>()
let saveTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setTimeout> | undefined
let syncing = false
let syncAgain = false
let noticeId = 0
// Rebuilding the index is async and files keep moving; only the newest answer
// is allowed to land.
let indexSeq = 0

interface AppState {
  phase: 'loading' | 'login' | 'ready'
  user: string
  /**
   * Whether this device holds a session.
   *
   * Not derivable from the vault list, which is what the UI used to ask: a
   * machine with nothing but folders opened from disk has no server vault to
   * infer it from, and that is exactly the machine on which signing in — and
   * so publishing a folder — has to stay reachable.
   */
  signedIn: boolean
  device: string
  vaults: Vault[]
  currentVault: string | undefined
  files: FileMeta[]
  currentPath: string | undefined
  content: string
  unsaved: boolean
  pending: number
  /** Notes linking to the open one, newest computation wins. */
  backlinks: Backlink[]
  /** Every tag in the open vault, and the notes carrying it. */
  tags: TagSummary[]
  /**
   * What the note list is filtered by: free text, or `#tag`. It lives here
   * rather than in the sidebar because clicking a tag in the editor is what
   * sets it.
   */
  query: string
  sync: SyncState
  lastSyncedAt: number
  notices: Notice[]

  boot(): Promise<void>
  /**
   * Shows or hides the login screen over whatever is open. A device holding a
   * folder from disk is never bounced to it, so asking is the only way in —
   * and backing out has to leave the folder exactly as it was.
   */
  showLogin(show: boolean): void
  login(user: string, password: string): Promise<void>
  logout(): Promise<void>
  /**
   * Changes the account's own password. Throws on refusal so the sheet can
   * say which refusal it was; the caller is ui/actions.ts.
   */
  changePassword(input: { current: string; next: string; signOutOthers: boolean }): Promise<void>
  selectVault(id: string): Promise<void>
  /**
   * Gives a vault kept in the app a folder as well. One-way, like every other
   * path here: there is no un-cloning, because the notes would have to be
   * deleted or left to two stores at once.
   */
  cloneVault(id: string): Promise<void>
  /** Picks a folder on disk and opens it as a vault of its own. */
  openFolder(): Promise<void>
  /**
   * Publishes a folder: the server gets a vault of its own, seeded from it,
   * and every device on the account can open it from then on.
   */
  promoteVault(id: string, name: string): Promise<void>
  /** Stops listing a folder. Never touches the folder or the notes in it. */
  forgetFolder(id: string): Promise<void>
  open(path: string): Promise<void>
  edit(text: string): void
  save(): Promise<void>
  createNote(title: string, folder?: string): Promise<string>
  deleteNote(path: string): Promise<void>
  renameNote(from: string, to: string, updateLinks?: boolean): Promise<string>
  /** How many notes link to this one — what a rename is about to break. */
  linksTo(path: string): Promise<number>
  attach(file: File): Promise<string>
  /** A note's text as this device holds it, unsaved edits excluded. */
  readNote(path: string): Promise<string>
  blobUrl(path: string): Promise<string | undefined>
  syncNow(): Promise<void>
  search(query: string): Promise<SearchHit[]>
  setQuery(query: string): void
  /** Says something to whoever is using the app, in the same strip sync uses. */
  notify(kind: 'info' | 'error', text: string): void
  dismissNotice(id: number): void
}

/**
 * How the app asks where a vault should live. Undefined means the question was
 * dismissed, which leaves it unanswered.
 *
 * Injected rather than imported: asking is a UI concern and the store is below
 * it — everywhere else the UI asks and the store does, but boot has to open a
 * vault before any of that is on screen, so it hands the question back up.
 */
export type WhereAsker = (vaultName: string) => Promise<'folder' | 'app' | undefined>

let askWhere: WhereAsker = async () => undefined

export function onAskWhereVaultLives(asker: WhereAsker): void {
  askWhere = asker
}

export const useApp = create<AppState>()((set, get) => {
  const notice = (kind: Notice['kind'], text: string) => {
    set((s) => ({ notices: [...s.notices, { id: ++noticeId, kind, text }] }))
  }

  /** True for a folder opened from disk, which belongs to no account. */
  const isLocalVault = (id: string): boolean =>
    get().vaults.some((v) => v.id === id && isLocal(v))

  /** The sync light for the open vault: a folder never syncs, whatever else is wrong. */
  const syncStateFor = (fallback: SyncState): SyncState => {
    const id = get().currentVault
    return id && isLocalVault(id) ? 'local' : fallback
  }

  /** The local half of a vault, created the first time it is needed. */
  const runtimeFor = (vaultId: string): Runtime => {
    const { user, device } = get()
    const local = isLocalVault(vaultId)
    // A folder is the same folder whoever is signed in, so it is keyed by
    // itself. A synced vault is keyed by account too: two accounts on one
    // browser must never share a local store.
    const key = local ? `local/${vaultId}` : `${user}/${vaultId}`
    const existing = runtimes.get(key)
    if (existing) return existing

    const store = createVaultStore(user, vaultId, isFolderBacked(vaultId))
    if (local) {
      const runtime = { store, index: new VaultIndex() }
      runtimes.set(key, runtime)
      return runtime
    }
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
    const runtime = { store, engine, index: new VaultIndex() }
    runtimes.set(key, runtime)
    return runtime
  }

  /**
   * Makes sure this device has decided where a synced vault's notes go, asking
   * once if it has not.
   *
   * The shell can keep a vault either way and nobody but the user can say
   * which, so it is asked rather than defaulted. Dismissing settles nothing on
   * purpose: the vault stays unopened and the question comes back, which beats
   * choosing on their behalf and cloning notes they never asked for.
   */
  const settleVaultMode = async (id: string): Promise<boolean> => {
    if ((await vaultMode(id)) !== 'unset') return true
    const name = get().vaults.find((v) => v.id === id)?.name ?? id
    const answer = await askWhere(name)
    if (!answer) return false
    try {
      if (answer === 'app') {
        await keepInApp(id)
        return true
      }
      return (await cloneToFolder(id)) !== undefined
    } catch (err) {
      notice('error', `${name} could not be set up here: ${String(err)}`)
      return false
    }
  }

  const current = (): Runtime | undefined => {
    const id = get().currentVault
    return id ? runtimeFor(id) : undefined
  }

  const refreshFiles = async () => {
    const id = get().currentVault
    const runtime = current()
    if (!id || !runtime) {
      set({ files: [], pending: 0, backlinks: [], tags: [] })
      return
    }
    const files = await runtime.store.list()
    // Nothing is ever queued for a folder on disk: it is already where it goes.
    const pending = isLocalVault(id) ? 0 : (await runtime.store.pending()).length
    set({ files, pending })
    scheduleIndex()
  }

  /**
   * Who points at the open note, and what tags the vault carries.
   *
   * Deliberately not awaited: it reads every note whose hash moved, and the
   * note you asked for must not wait behind a scan of the vault. The panel and
   * the tag list fill in a moment later, and only the newest answer lands.
   */
  const refreshIndex = async () => {
    const runtime = current()
    const seq = ++indexSeq
    if (!runtime) {
      if (get().backlinks.length || get().tags.length) set({ backlinks: [], tags: [] })
      return
    }
    await runtime.index.rebuild(get().files, (p) => runtime.store.read(p))
    if (seq !== indexSeq) return

    const path = get().currentPath
    const backlinks = path && isNote(path) ? runtime.index.to(path) : []
    if (!sameBacklinks(get().backlinks, backlinks)) set({ backlinks })
    const tags = runtime.index.allTags()
    if (!sameTags(get().tags, tags)) set({ tags })
  }

  const scheduleIndex = () => {
    void refreshIndex().catch((err) => console.warn('indexing the vault failed', err))
  }

  /**
   * The notes whose text points at `path`, from an up-to-date link map.
   *
   * Every link, not only the ones the backlinks strip shows: a rename has to
   * find `[[handout.pdf]]` too, or it breaks it without saying so.
   */
  const linkingNotes = async (runtime: Runtime, path: string): Promise<string[]> => {
    await runtime.index.rebuild(get().files, (p) => runtime.store.read(p))
    return runtime.index.mentioning(path)
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

  /**
   * Which vault to open on launch. A folder in a browser whose permission has
   * lapsed cannot be opened without a click, so it gives way to a vault that
   * can. If there is none it is chosen anyway, so that selecting it produces
   * the notice explaining why the list is empty.
   */
  const bootVault = async (user: string): Promise<string | undefined> => {
    const vaults = get().vaults
    const chosen = chooseVault(vaults, user, persisted.lastVault())
    // Folder-backed, not local: a promoted folder still lives behind a browser
    // permission, and is no longer a local vault.
    if (!chosen || !isFolderBacked(chosen) || (await accessGranted(chosen))) return chosen
    return chooseVault(vaults.filter((v) => !isFolderBacked(v.id)), user) ?? chosen
  }

  const adoptIdentity = async (user: string, vaults: VaultSummary[]) => {
    persisted.setUser(user)
    persisted.setVaults(vaults)
    // The folders opened on this device are not the server's to list, and
    // outlive any answer it gives.
    const merged = mergeVaults(vaults, get().vaults.filter(isLocal))
    set({ user, signedIn: true, vaults: merged })
    const chosen = chooseVault(merged, user, persisted.lastVault())
    if (chosen) await get().selectVault(chosen)
  }

  return {
    phase: 'loading',
    user: '',
    signedIn: false,
    device: '',
    vaults: [],
    currentVault: undefined,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    pending: 0,
    backlinks: [],
    tags: [],
    query: '',
    sync: 'idle',
    lastSyncedAt: 0,
    notices: [],

    async boot() {
      const device = persisted.device()
      const cachedUser = persisted.user() ?? ''
      const cachedVaults = persisted.vaults()
      const folders = (await listFolders())
        .filter((f) => !f.synced)
        .map((f): LocalVaultSummary => ({ ...f, kind: 'local' }))
      // What this device last believed. An unreachable server must not read as
      // a sign-out: the session is still there, it just cannot be asked about.
      const wasSignedIn = cachedUser !== '' && cachedVaults.length > 0
      set({ device, user: cachedUser, signedIn: wasSignedIn, vaults: mergeVaults(cachedVaults, folders) })
      if (!desktop) void requestPersistence()

      // An offline launch must never bounce you to a login you cannot reach:
      // with something already on this device — a synced vault, or a folder
      // opened from disk — go straight in and sort the session out afterwards.
      const openable = (cachedUser !== '' && cachedVaults.length > 0) || folders.length > 0
      if (openable) {
        set({ phase: 'ready' })
        const chosen = await bootVault(cachedUser)
        if (chosen) await get().selectVault(chosen)
      }

      let identity
      try {
        identity = await api.session()
      } catch {
        // The server is unreachable. With a local vault that is not an error:
        // read and write offline, and sync when the network comes back.
        set({ sync: syncStateFor('offline'), phase: openable ? 'ready' : 'login' })
        return
      }
      if (!identity) {
        // Sitting in a folder from disk, there is no session to miss.
        set({
          signedIn: false,
          ...(openable ? { sync: syncStateFor('needs-login') } : { phase: 'login' }),
        })
        return
      }
      set({ phase: 'ready' })
      await adoptIdentity(identity.user, identity.vaults)
      await get().syncNow()
      await openFirstNote()
    },

    showLogin(show) {
      // Nothing to go back to: until a vault or a folder is open the login
      // screen is the whole app, and dismissing it would leave a blank one.
      if (!show && !get().currentVault) return
      set({ phase: show ? 'login' : 'ready' })
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
      const folders = get().vaults.filter(isLocal)
      for (const key of [...runtimes.keys()]) {
        if (!key.startsWith('local/')) runtimes.delete(key)
      }
      set({
        phase: 'login',
        signedIn: false,
        sync: 'idle',
        vaults: folders,
        currentVault: undefined,
        files: [],
        currentPath: undefined,
        content: '',
        unsaved: false,
        backlinks: [],
        tags: [],
      })
      // A folder from disk was never the account's, so signing out does not
      // close it — there is still somewhere to be.
      if (folders.length > 0) {
        set({ phase: 'ready' })
        await get().selectVault(folders[0].id)
      }
    },

    async changePassword(input) {
      const { signedOut } = await api.changePassword(input)
      // Worth a notice rather than silence: "sign out my other devices" is a
      // thing you should be told actually happened.
      notice(
        'info',
        signedOut > 0
          ? `Password changed. ${signedOut} other ${signedOut === 1 ? 'device' : 'devices'} signed out.`
          : 'Password changed.',
      )
    },

    async selectVault(id) {
      if (get().unsaved) await get().save()
      if (get().currentVault === id) return
      // Before the store is chosen, because the store *is* the answer: a
      // folder-backed vault and one kept in the app are different sides of the
      // seam, and runtimeFor has to know which before it builds anything.
      if (!isLocalVault(id) && !(await settleVaultMode(id))) return
      // A folder opened in a browser holds its permission only as long as the
      // tab, so re-granting it is the normal path on a cold start. The browser
      // will ask only while the click that got here is still fresh, which is
      // why this comes before anything slow.
      if (isFolderBacked(id) && !(await ensureAccess(id))) {
        const name = get().vaults.find((v) => v.id === id)?.name ?? id
        notice('info', `${name} needs permission again — choose it in the list to let the browser ask.`)
        return
      }
      persisted.setLastVault(id)
      set({
        currentVault: id,
        currentPath: undefined,
        content: '',
        unsaved: false,
        backlinks: [],
        tags: [],
        query: '',
      })

      const runtime = runtimeFor(id)
      // Eviction is a browser-storage problem. A folder on disk cannot be
      // cleared out from under the app, and has nowhere to re-download from.
      if (!isLocalVault(id) && (await detectEviction(runtime.store))) {
        notice('info', 'This device had been cleared by the browser. Re-downloading your notes…')
      }
      try {
        await refreshFiles()
      } catch (err) {
        // A folder that has been moved, renamed or unplugged. Saying so beats
        // an empty note list, which reads as "your notes are gone".
        const name = get().vaults.find((v) => v.id === id)?.name ?? id
        set({ files: [], pending: 0, backlinks: [] })
        notice('error', `${name} could not be read: ${String(err)}`)
        return
      }
      await openFirstNote()
      scheduleSync(0)
    },

    async cloneVault(id) {
      let cloned
      try {
        cloned = await cloneToFolder(id)
      } catch (err) {
        notice('error', `Could not keep it as files: ${String(err)}`)
        return
      }
      if (!cloned) return
      // Its bytes live in a folder from here on, so the runtime built over the
      // app's own storage is dropped and rebuilt over the new one. The folder
      // starts empty and the first sync fills it — adopting whatever already
      // matched, if it was pointed at a copy of the notes.
      runtimes.delete(`${get().user}/${id}`)
      notice('info', `${cloned.name} is a folder on this machine now.`)
      if (get().currentVault === id) {
        set({ currentVault: undefined })
        await get().selectVault(id)
      }
    },

    async openFolder() {
      let picked
      try {
        picked = await pickFolder()
      } catch (err) {
        // The shell refuses a folder it already manages as a synced vault.
        notice('error', String(err))
        return
      }
      if (!picked) return // the picker was dismissed

      if (picked.synced) {
        // Already published: it is one of the account's vaults, not a folder
        // waiting to become one.
        await get().selectVault(picked.id)
        return
      }
      const folder: LocalVaultSummary = { ...picked, kind: 'local' }
      const server = get().vaults.filter((v): v is VaultSummary => !isLocal(v))
      const folders = get().vaults.filter(isLocal).filter((v) => v.id !== folder.id)
      set({ vaults: mergeVaults(server, [...folders, folder]) })

      // mergeVaults drops a folder whose id a server vault already answers to.
      // Opening it anyway would put a sync engine over a private folder.
      if (!isLocalVault(folder.id)) {
        notice('error', `${folder.name} could not be opened: a vault on the server has its id`)
        return
      }
      await get().selectVault(folder.id)
    },

    async promoteVault(id, name) {
      const folder = get().vaults.find((v) => v.id === id)
      if (!folder || !isLocal(folder)) return
      const serverId = slugForVault(name)
      if (!serverId) {
        notice('error', 'That name has no letters or digits in it to make an id from.')
        return
      }

      // Weighed here rather than trusted from the folder: the server is being
      // told what it is about to receive so it can refuse before anything is
      // created on the Pi.
      const files = await runtimeFor(id).store.list()
      const bytes = files.reduce((total, f) => total + f.size, 0)

      let created
      try {
        created = await api.createVault({ id: serverId, name, bytes })
      } catch (err) {
        notice('error', err instanceof Error ? err.message : 'could not create the vault')
        return
      }

      // The vault exists on the server from here on. If re-keying the folder
      // fails, that vault is real but empty, and saying so is better than
      // leaving a folder pointing at a name nothing answers to.
      try {
        await promoteFolder(id, serverId)
      } catch (err) {
        notice(
          'error',
          `${created.name} was created on the server but this folder could not be attached to it: ${String(err)}`,
        )
        return
      }

      // The local vault is gone as a thing in its own right; what took its
      // place is a vault of the account's, whose files happen to be here.
      runtimes.delete(`local/${id}`)
      set((state) => ({
        vaults: mergeVaults(
          [...state.vaults.filter((v): v is VaultSummary => !isLocal(v)), created],
          state.vaults.filter(isLocal).filter((v) => v.id !== id),
        ),
        currentVault: state.currentVault === id ? undefined : state.currentVault,
      }))
      persisted.setVaults(get().vaults.filter((v): v is VaultSummary => !isLocal(v)))

      await get().selectVault(serverId)
      notice('info', `${created.name} is syncing. Your other devices can open it once it finishes.`)
    },

    async forgetFolder(id) {
      const folder = get().vaults.find((v) => v.id === id)
      if (!folder || !isLocal(folder)) return
      await forgetFolderOnDisk(id)
      runtimes.delete(`local/${id}`)

      const rest = get().vaults.filter((v) => v.id !== id)
      set({ vaults: rest })
      if (get().currentVault === id) {
        set({
          currentVault: undefined,
          currentPath: undefined,
          content: '',
          unsaved: false,
          files: [],
          backlinks: [],
          tags: [],
        })
        const next = chooseVault(rest, get().user)
        if (next) await get().selectVault(next)
        else set({ phase: 'login' })
      }
      notice('info', `${folder.name} is no longer listed here. The folder itself is untouched.`)
    },

    async open(path) {
      const runtime = current()
      if (!runtime) return
      if (get().unsaved) await get().save()

      // A PDF is opened by path. Its bytes go straight from the store to a
      // viewer when one asks for them; reading two megabytes of binary here
      // and decoding it as UTF-8 would fill the editor buffer with rubbish and
      // the phone's memory with a copy of it.
      if (!isNote(path)) {
        if (!(await runtime.store.meta(path))) {
          notice('error', `${path} is not stored on this device yet`)
          return
        }
        set({ currentPath: path, content: '', unsaved: false, backlinks: [] })
        return
      }

      try {
        const data = await runtime.store.read(path)
        set({ currentPath: path, content: decodeText(data), unsaved: false })
        scheduleIndex()
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
        set({ currentPath: undefined, content: '', unsaved: false, backlinks: [] })
      }
      await refreshFiles()
      scheduleSync()
    },

    async renameNote(from, to, updateLinks = false) {
      const runtime = current()
      if (!runtime) throw new Error('no vault is open')
      // What is on screen is what should end up under the new name, not
      // whatever the debounced save last managed to store.
      if (get().unsaved) await get().save()

      const before = get().files
      const target = uniquePath(to, before)
      // Worked out before anything moves: afterwards the old name resolves to
      // nothing and there is no way to tell which links meant this note.
      const linking = updateLinks ? await linkingNotes(runtime, from) : []

      const data = await runtime.store.read(from)
      await runtime.store.write(target, data)
      await runtime.store.delete(from)

      let rewritten = 0
      if (linking.length > 0) {
        const after = await runtime.store.list()
        const name = target.slice(target.lastIndexOf('/') + 1).replace(/\.md$/i, '')
        const shortNameWorks = buildResolver(after)(name) === target
        const resolve = buildResolver(before)

        for (const path of linking) {
          let text: string
          try {
            text = decodeText(await runtime.store.read(path))
          } catch {
            // Not stored on this device. Its links keep the old name, which is
            // better than dropping the rename half-done to say so.
            continue
          }
          const next = retargetLinks(text, { resolve, from, to: target, shortNameWorks })
          if (next.changed === 0) continue
          await runtime.store.write(path, encodeText(next.text))
          rewritten++
        }
      }

      await refreshFiles()
      const open = get().currentPath
      if (open === from) await get().open(target)
      else if (open && linking.includes(open)) await get().open(open)

      if (rewritten > 0) {
        notice('info', `${noteTitle(from)} is now ${noteTitle(target)}; ${rewritten} note${rewritten === 1 ? '' : 's'} updated`)
      }
      scheduleSync()
      return target
    },

    async linksTo(path) {
      const runtime = current()
      if (!runtime) return 0
      return (await linkingNotes(runtime, path)).length
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

    async readNote(path) {
      const runtime = current()
      if (!runtime) throw new Error('no vault is open')
      return decodeText(await runtime.store.read(path))
    },

    async blobUrl(path) {
      const runtime = current()
      if (!runtime) return undefined
      try {
        const data = await runtime.store.read(path)
        // Typed, not bare: an <img> will sniff its own bytes, a PDF frame or a
        // download will not, and hands back an empty page instead.
        return URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType(path) }))
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
      // A folder from disk has nothing to sync with; the account's vaults are
      // still worth keeping fresh behind it.
      const open = isLocalVault(currentVault) ? undefined : runtimeFor(currentVault).engine
      syncing = true
      set({ sync: open ? 'syncing' : 'local' })
      try {
        // The open vault first, so what you are looking at is current soonest;
        // the others follow so a switch is instant.
        if (open) {
          const stats = await open.sync()
          set({ sync: 'idle', lastSyncedAt: Date.now() })
          await refreshFiles()

          // If the open note changed underneath us, show the new bytes — but
          // never over unsaved typing.
          const { currentPath, unsaved } = get()
          if (currentPath && !unsaved && stats.pulled + stats.conflicts > 0) {
            const runtime = runtimeFor(currentVault)
            const meta = await runtime.store.meta(currentPath)
            if (!meta) {
              set({ currentPath: undefined, content: '', backlinks: [] })
            } else {
              const text = decodeText(await runtime.store.read(currentPath))
              if (text !== get().content) set({ content: text })
            }
          }
        }

        for (const vault of vaults) {
          if (vault.id === currentVault) continue
          const engine = runtimeFor(vault.id).engine
          if (!engine) continue
          try {
            await engine.sync()
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
          set({ sync: 'needs-login', signedIn: false })
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
      const { store } = runtimeFor(vaultId)
      // No index on the server for a folder it has never seen: scan it here.
      if (isLocalVault(vaultId)) return localSearch(q, get().files, store)
      try {
        return await api.vault(vaultId).search(q)
      } catch {
        return localSearch(q, get().files, store)
      }
    },

    setQuery(query) {
      set({ query })
    },

    notify(kind, text) {
      notice(kind, text)
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
