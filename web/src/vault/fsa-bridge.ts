import type { FolderBridge } from './folder-store'
import { sha256Hex } from './hash'
import { isIgnored, isPrunedDir } from './ignore'

/**
 * A folder opened from disk in a browser, through the File System Access API.
 *
 * This is the browser's half of what `tauri-bridge.ts` does for the desktop:
 * find the folder, read and write inside it, and keep the sync bookkeeping
 * anywhere but in it. The folder semantics on top are `FolderVaultStore`, the
 * same class the shell uses, so a folder means one thing in both.
 *
 * Chromium only. Safari and Firefox implement the Origin Private File System —
 * a sandbox the browser owns — but not a picker onto the user's own
 * directories, and iOS has neither. `fsaSupported()` is the gate.
 */

/**
 * The API is only half in TypeScript's DOM lib: the private-filesystem half.
 * These are the parts Chromium adds on top, declared here rather than taken as
 * a dependency for four signatures.
 */
declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite'
      id?: string
      startIn?: string
    }): Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemHandle {
    queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  }
}

const DB_NAME = 'quartz-folders'
const DB_VERSION = 1
/** id → the folder itself. Directory handles survive a restart in IndexedDB. */
const HANDLES = 'handles'
/** id → sync bookkeeping, kept out here rather than written into the vault. */
const STATE = 'state'

const ACCESS = { mode: 'readwrite' } as const

interface StoredFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
}

/** True where a folder can be opened from disk: Chromium, in a secure context. */
export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

let dbPromise: Promise<IDBDatabase> | undefined

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const d = req.result
        if (!d.objectStoreNames.contains(HANDLES)) d.createObjectStore(HANDLES, { keyPath: 'id' })
        if (!d.objectStoreNames.contains(STATE)) d.createObjectStore(STATE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function reading<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** A write is only done when its transaction commits, not when the call returns. */
function writing(tx: IDBTransaction, body: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    body()
  })
}

async function allFolders(): Promise<StoredFolder[]> {
  const d = await db()
  return reading(d.transaction(HANDLES, 'readonly').objectStore(HANDLES).getAll())
}

async function storedFolder(id: string): Promise<StoredFolder | undefined> {
  const d = await db()
  return reading(d.transaction(HANDLES, 'readonly').objectStore(HANDLES).get(id))
}

/**
 * The id shape the desktop shell uses, so nothing above this layer has to know
 * which of the two opened the folder. There is no path to derive it from in a
 * browser — sameness is decided by `isSameEntry` instead.
 */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return `local-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export interface FsaFolder {
  id: string
  name: string
}

export async function listFsaFolders(): Promise<FsaFolder[]> {
  if (!fsaSupported()) return []
  return (await allFolders()).map(({ id, name }) => ({ id, name }))
}

/**
 * Asks for a folder and remembers it. Undefined means the picker was
 * dismissed. Opening the same folder twice returns the vault already there,
 * exactly as it does on the desktop — here the browser decides sameness,
 * since a page is never told where a folder actually is.
 */
export async function pickFsaFolder(): Promise<FsaFolder | undefined> {
  if (!fsaSupported()) throw new Error('this browser cannot open a folder from disk')
  let handle: FileSystemDirectoryHandle
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'quartz-vault' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return undefined
    throw err
  }
  for (const existing of await allFolders()) {
    if (await existing.handle.isSameEntry(handle)) return { id: existing.id, name: existing.name }
  }
  const folder: StoredFolder = { id: newId(), name: handle.name, handle }
  const d = await db()
  const tx = d.transaction(HANDLES, 'readwrite')
  await writing(tx, () => tx.objectStore(HANDLES).put(folder))
  return { id: folder.id, name: folder.name }
}

/** Stops listing a folder. The folder and its notes are never touched. */
export async function forgetFsaFolder(id: string): Promise<void> {
  const d = await db()
  const tx = d.transaction([HANDLES, STATE], 'readwrite')
  await writing(tx, () => {
    tx.objectStore(HANDLES).delete(id)
    tx.objectStore(STATE).delete(id)
  })
}

/** Whether the browser will already let us read and write this folder. */
export async function fsaAccessGranted(id: string): Promise<boolean> {
  const folder = await storedFolder(id)
  if (!folder) return false
  return (await folder.handle.queryPermission(ACCESS)) === 'granted'
}

/**
 * Makes sure the folder can be read and written, asking the browser if not.
 *
 * A handle outlives the tab but its permission usually does not, so this is
 * the normal path on a cold start rather than an edge case. The browser only
 * asks while a click is still fresh, so with no activation left this reports
 * failure instead of spending the one chance to ask on a prompt nobody
 * connected to anything they did.
 */
export async function ensureFsaAccess(id: string): Promise<boolean> {
  const folder = await storedFolder(id)
  if (!folder) return false
  if ((await folder.handle.queryPermission(ACCESS)) === 'granted') return true
  if (navigator.userActivation && !navigator.userActivation.isActive) return false
  try {
    return (await folder.handle.requestPermission(ACCESS)) === 'granted'
  } catch {
    return false
  }
}

async function hasEntries(dir: FileSystemDirectoryHandle): Promise<boolean> {
  return !(await dir.entries().next()).done
}

/**
 * Reading and writing inside a directory, over any way of reaching it.
 *
 * Separated from the folder registry so it can be exercised against a fake
 * handle: everything below is the File System Access API and nothing else.
 */
export function folderOps(
  root: () => Promise<FileSystemDirectoryHandle>,
): Pick<FolderBridge, 'list' | 'read' | 'write' | 'remove'> {
  // The store hashes every file on every listing. In Rust that is merely
  // wasteful; in JavaScript over a real vault it is the difference between
  // usable and not, so the answer is remembered. Size and last-modified both
  // matching means the bytes did too.
  const hashes = new Map<string, { size: number; mtime: number; hash: string }>()

  /** Walks to the directory holding a path, and the name it holds it under. */
  const dirFor = async (path: string, create: boolean) => {
    const segments = path.split('/')
    const name = segments.pop()
    if (!name) throw new Error(`invalid path: ${path}`)
    let dir = await root()
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create })
    return { dir, name, segments }
  }

  return {
    async list() {
      const out: { path: string; hash: string; size: number; mtime: number }[] = []

      const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        for await (const [name, entry] of dir.entries()) {
          const path = prefix ? `${prefix}/${name}` : name
          if (entry.kind === 'directory') {
            if (!isPrunedDir(name)) await walk(entry as FileSystemDirectoryHandle, path)
            continue
          }
          if (isIgnored(path)) continue
          const file = await (entry as FileSystemFileHandle).getFile()
          const cached = hashes.get(path)
          let hash = cached?.size === file.size && cached?.mtime === file.lastModified ? cached.hash : undefined
          if (hash === undefined) {
            hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()))
            hashes.set(path, { size: file.size, mtime: file.lastModified, hash })
          }
          out.push({ path, hash, size: file.size, mtime: file.lastModified })
        }
      }

      await walk(await root(), '')
      return out.sort((a, b) => a.path.localeCompare(b.path))
    },

    async read(path) {
      const { dir, name } = await dirFor(path, false)
      const file = await (await dir.getFileHandle(name)).getFile()
      return new Uint8Array(await file.arrayBuffer())
    },

    async write(path, data) {
      const { dir, name } = await dirFor(path, true)
      const handle = await dir.getFileHandle(name, { create: true })
      // A writable stages the bytes and swaps them in on close, so no reader —
      // Obsidian included — ever sees half a note. The same promise the shell
      // makes by renaming a temporary file over the real one.
      const writable = await handle.createWritable()
      await writable.write(data as BufferSource)
      await writable.close()
      hashes.delete(path)
    },

    async remove(path) {
      const segments = path.split('/')
      const name = segments.pop()
      if (!name) return
      const chain: FileSystemDirectoryHandle[] = [await root()]
      try {
        for (const segment of segments) {
          chain.push(await chain[chain.length - 1].getDirectoryHandle(segment))
        }
        await chain[chain.length - 1].removeEntry(name)
      } catch (err) {
        // Already gone is not a failure, the way it is not on the shell.
        if (err instanceof DOMException && err.name === 'NotFoundError') return
        throw err
      }
      hashes.delete(path)
      // Leave no empty folders behind, the way Obsidian does.
      for (let i = chain.length - 1; i > 0; i--) {
        if (await hasEntries(chain[i])) break
        await chain[i - 1].removeEntry(segments[i - 1])
      }
    },

  }
}

/**
 * The bridge for one folder. Built synchronously and resolved per call, so a
 * vault's runtime can be created without waiting on IndexedDB — and so a
 * permission that lapses between calls is noticed rather than assumed.
 */
export function fsaBridge(id: string): FolderBridge {
  const root = async (): Promise<FileSystemDirectoryHandle> => {
    const folder = await storedFolder(id)
    if (!folder) throw new Error('this folder is not open in this browser any more')
    if ((await folder.handle.queryPermission(ACCESS)) !== 'granted') {
      throw new Error(`${folder.name} needs permission again`)
    }
    return folder.handle
  }

  return {
    ...folderOps(root),

    // Bookkeeping belongs beside the app's own storage, never inside the
    // vault: the folder holds notes and nothing else.
    async stateRead() {
      const d = await db()
      const raw = await reading<string | undefined>(
        d.transaction(STATE, 'readonly').objectStore(STATE).get(id),
      )
      return raw ?? ''
    },

    async stateWrite(json) {
      const d = await db()
      const tx = d.transaction(STATE, 'readwrite')
      await writing(tx, () => tx.objectStore(STATE).put(json, id))
    },
  }
}
