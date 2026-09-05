import { sha256Hex } from './hash'
import type { FileMeta, FileRecord, PendingOp, VaultStore } from './types'

const DB_VERSION = 1
const FILES = 'files'
const BLOBS = 'blobs'
const META = 'meta'

/**
 * The browser implementation of the storage seam.
 *
 * Metadata and contents live in separate stores so the note list can be built
 * without pulling every attachment into memory.
 */
export class IdbVaultStore implements VaultStore {
  private dbPromise: Promise<IDBDatabase> | undefined

  /** The database name is a parameter so tests (and, one day, a second vault)
   * can hold more than one store in the same browser. */
  constructor(private readonly dbName = 'quartz') {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'path' })
          if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return this.dbPromise
  }

  private async tx<T>(
    stores: string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const db = await this.db()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode)
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
      Promise.resolve(body(tx))
        .then((value) => {
          result = value
        })
        .catch((err) => {
          reject(err)
          tx.abort()
        })
    })
  }

  async list(): Promise<FileMeta[]> {
    const records = await this.allRecords()
    return records
      .filter((r) => !r.deleted)
      .map(({ path, hash, size, mtime }) => ({ path, hash, size, mtime }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }

  async read(path: string): Promise<Uint8Array> {
    const data = await this.tx([BLOBS], 'readonly', (tx) => request<ArrayBuffer>(tx.objectStore(BLOBS).get(path)))
    const buffer = await data
    if (!buffer) throw new Error(`not stored locally: ${path}`)
    return new Uint8Array(buffer)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const hash = await sha256Hex(data)
    const existing = await this.meta(path)
    const record: FileRecord = {
      path,
      hash,
      size: data.byteLength,
      mtime: Date.now(),
      baseHash: existing?.baseHash ?? '',
      deleted: false,
    }
    await this.put(record, data)
  }

  async delete(path: string): Promise<void> {
    const existing = await this.meta(path)
    if (!existing) return
    if (!existing.baseHash) {
      // The server never saw it, so there is nothing to tell it about.
      await this.forget(path)
      return
    }
    await this.put({ ...existing, deleted: true, mtime: Date.now() }, undefined)
  }

  async pending(): Promise<PendingOp[]> {
    const records = await this.allRecords()
    return records
      .filter((r) => (r.deleted ? true : r.hash !== r.baseHash))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((r) =>
        r.deleted
          ? { op: 'del' as const, path: r.path, baseHash: r.baseHash }
          : { op: 'put' as const, path: r.path, baseHash: r.baseHash },
      )
  }

  async meta(path: string): Promise<FileRecord | undefined> {
    return this.tx([FILES], 'readonly', (tx) => request<FileRecord>(tx.objectStore(FILES).get(path)))
  }

  async applyRemote(path: string, data: Uint8Array, hash: string): Promise<void> {
    await this.put(
      { path, hash, size: data.byteLength, mtime: Date.now(), baseHash: hash, deleted: false },
      data,
    )
  }

  async removeRemote(path: string): Promise<void> {
    await this.forget(path)
  }

  async markPushed(path: string, hash: string): Promise<void> {
    const existing = await this.meta(path)
    if (!existing) return
    await this.tx([FILES], 'readwrite', (tx) => {
      tx.objectStore(FILES).put({ ...existing, baseHash: hash })
    })
  }

  async forget(path: string): Promise<void> {
    await this.tx([FILES, BLOBS], 'readwrite', (tx) => {
      tx.objectStore(FILES).delete(path)
      tx.objectStore(BLOBS).delete(path)
    })
  }

  async cursor(): Promise<number> {
    const value = await this.flag('cursor')
    return value ? Number(value) : 0
  }

  async setCursor(seq: number): Promise<void> {
    await this.setFlag('cursor', String(seq))
  }

  async flag(key: string): Promise<string | undefined> {
    return this.tx([META], 'readonly', (tx) => request<string>(tx.objectStore(META).get(key)))
  }

  async setFlag(key: string, value: string): Promise<void> {
    await this.tx([META], 'readwrite', (tx) => {
      tx.objectStore(META).put(value, key)
    })
  }

  async clear(): Promise<void> {
    await this.tx([FILES, BLOBS, META], 'readwrite', (tx) => {
      tx.objectStore(FILES).clear()
      tx.objectStore(BLOBS).clear()
      tx.objectStore(META).clear()
    })
  }

  private async allRecords(): Promise<FileRecord[]> {
    const records = await this.tx([FILES], 'readonly', (tx) =>
      request<FileRecord[]>(tx.objectStore(FILES).getAll()),
    )
    return records ?? []
  }

  private async put(record: FileRecord, data: Uint8Array | undefined): Promise<void> {
    await this.tx([FILES, BLOBS], 'readwrite', (tx) => {
      tx.objectStore(FILES).put(record)
      if (data) {
        const copy = new Uint8Array(data)
        tx.objectStore(BLOBS).put(copy.buffer, record.path)
      }
    })
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}
