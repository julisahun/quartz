import {
  ApiError,
  OfflineError,
  type Api,
  type Change,
  type ChangePage,
  type SearchHit,
  type Snapshot,
} from '../api/client'
import { sha256Hex } from '../vault/hash'
import type { FileMeta } from '../vault/types'

interface Stored {
  data: Uint8Array
  hash: string
  size: number
  mtime: number
}

/**
 * An in-memory stand-in for the Go server, implementing the same precondition
 * and journal semantics. Tests drive several clients against one instance,
 * exactly as several devices share one Pi.
 */
export class FakeServer {
  files = new Map<string, Stored>()
  changes: Change[] = []
  epoch = 'epoch-1'
  private seq = 0

  async put(path: string, data: Uint8Array, ifMatch: string, mustNotExist: boolean): Promise<FileMeta> {
    const current = this.files.get(path)
    if (mustNotExist && current) throw this.conflict(current.hash)
    if (!mustNotExist && !current) throw this.conflict('')
    if (!mustNotExist && current!.hash !== ifMatch) throw this.conflict(current!.hash)

    const hash = await sha256Hex(data)
    if (current?.hash === hash) return { path, hash, size: data.byteLength, mtime: current.mtime }

    const stored: Stored = { data: new Uint8Array(data), hash, size: data.byteLength, mtime: Date.now() }
    this.files.set(path, stored)
    this.changes.push({ seq: ++this.seq, path, op: 'put', hash, size: stored.size, mtime: stored.mtime, ts: Date.now() })
    return { path, hash, size: stored.size, mtime: stored.mtime }
  }

  async delete(path: string, ifMatch: string): Promise<void> {
    const current = this.files.get(path)
    if (!current) return
    if (current.hash !== ifMatch) throw this.conflict(current.hash)
    this.files.delete(path)
    this.changes.push({ seq: ++this.seq, path, op: 'del', ts: Date.now() })
  }

  /** Simulates the server's index being deleted and rebuilt from the vault. */
  async rebuildIndex(): Promise<void> {
    this.seq = 0
    this.changes = []
    this.epoch = `epoch-${Math.random().toString(16).slice(2)}`
    for (const [path, stored] of [...this.files].sort(([a], [b]) => a.localeCompare(b))) {
      this.changes.push({
        seq: ++this.seq,
        path,
        op: 'put',
        hash: stored.hash,
        size: stored.size,
        mtime: stored.mtime,
        ts: Date.now(),
      })
    }
  }

  /** Writes straight into the vault, the way Obsidian does. */
  async writeExternally(path: string, text: string): Promise<void> {
    const data = new TextEncoder().encode(text)
    const hash = await sha256Hex(data)
    this.files.set(path, { data, hash, size: data.byteLength, mtime: Date.now() })
    this.changes.push({ seq: ++this.seq, path, op: 'put', hash, size: data.byteLength, mtime: Date.now(), ts: Date.now() })
  }

  head(): number {
    return this.seq
  }

  private conflict(currentHash: string): ApiError {
    return new ApiError(412, 'conflict', 'the server has a different version', currentHash || undefined)
  }
}

/** One device's connection to the fake server, with a switch for each failure mode. */
export class FakeApi implements Api {
  online = true
  authed = true
  /** Every path the client asked for, useful for asserting round trips. */
  reads: string[] = []

  constructor(private readonly server: FakeServer) {}

  private check(): void {
    if (!this.online) throw new OfflineError()
    if (!this.authed) throw new ApiError(401, 'session_expired', 'sign in again')
  }

  async login(_user?: string, _password?: string, _device?: string, _desktop?: boolean): Promise<void> {
    if (!this.online) throw new OfflineError()
    this.authed = true
  }

  async logout(): Promise<void> {
    this.authed = false
  }

  async session(): Promise<boolean> {
    if (!this.online) throw new OfflineError()
    return this.authed
  }

  async snapshot(): Promise<Snapshot> {
    this.check()
    const files = [...this.server.files].map(([path, s]) => ({
      path,
      hash: s.hash,
      size: s.size,
      mtime: s.mtime,
    }))
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { head: this.server.head(), epoch: this.server.epoch, files }
  }

  async changes(since: number): Promise<ChangePage> {
    this.check()
    const changes = this.server.changes.filter((c) => c.seq > since)
    return { head: this.server.head(), epoch: this.server.epoch, changes, more: false }
  }

  async getFile(path: string): Promise<{ data: Uint8Array; hash: string }> {
    this.check()
    this.reads.push(path)
    const stored = this.server.files.get(path)
    if (!stored) throw new ApiError(404, 'not_found', 'no such file')
    return { data: new Uint8Array(stored.data), hash: stored.hash }
  }

  async putFile(path: string, data: Uint8Array, baseHash: string): Promise<FileMeta> {
    this.check()
    return this.server.put(path, data, baseHash, baseHash === '')
  }

  async deleteFile(path: string, baseHash: string): Promise<void> {
    this.check()
    return this.server.delete(path, baseHash)
  }

  async search(): Promise<SearchHit[]> {
    this.check()
    return []
  }
}
