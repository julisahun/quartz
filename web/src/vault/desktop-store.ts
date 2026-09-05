import { sha256Hex } from './hash'
import type { FileMeta, FileRecord, PendingOp, VaultStore } from './types'

/**
 * What the desktop shell must provide: a real folder, and somewhere outside it
 * to keep sync bookkeeping. Kept as an interface so the store can be tested
 * without Tauri, and so a different shell could supply the same thing.
 */
export interface DesktopBridge {
  list(): Promise<{ path: string; hash: string; size: number; mtime: number }[]>
  read(path: string): Promise<Uint8Array>
  write(path: string, data: Uint8Array): Promise<void>
  remove(path: string): Promise<void>
  /** Sync state, stored beside the app's config — never inside the vault. */
  stateRead(): Promise<string>
  stateWrite(json: string): Promise<void>
}

interface DesktopState {
  cursor: number
  flags: Record<string, string>
  /** path → the hash the server last confirmed. */
  base: Record<string, string>
}

const emptyState = (): DesktopState => ({ cursor: 0, flags: {}, base: {} })

/**
 * The folder implementation of the storage seam.
 *
 * The folder is the vault: a real directory that Obsidian can open at the same
 * time. Nothing is duplicated into a database, so a file deleted in Finder is
 * simply a file that is no longer listed — which is exactly what a pending
 * delete looks like.
 */
export class DesktopVaultStore implements VaultStore {
  private state: DesktopState | undefined

  constructor(private readonly bridge: DesktopBridge) {}

  private async load(): Promise<DesktopState> {
    if (this.state) return this.state
    let loaded: DesktopState
    try {
      const raw = await this.bridge.stateRead()
      loaded = raw ? { ...emptyState(), ...JSON.parse(raw) } : emptyState()
    } catch {
      // No state file yet, or an unreadable one: start over. The vault itself
      // is untouched, so the next sync reconciles against the manifest.
      loaded = emptyState()
    }
    this.state = loaded
    return loaded
  }

  private async persist(): Promise<void> {
    await this.bridge.stateWrite(JSON.stringify(await this.load()))
  }

  async list(): Promise<FileMeta[]> {
    const files = await this.bridge.list()
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  async read(path: string): Promise<Uint8Array> {
    return this.bridge.read(path)
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    await this.bridge.write(path, data)
  }

  async delete(path: string): Promise<void> {
    await this.bridge.remove(path)
  }

  async pending(): Promise<PendingOp[]> {
    const state = await this.load()
    const onDisk = new Map((await this.bridge.list()).map((f) => [f.path, f]))
    const ops: PendingOp[] = []

    for (const [path, file] of onDisk) {
      const base = state.base[path]
      if (base !== file.hash) ops.push({ op: 'put', path, baseHash: base ?? '' })
    }
    for (const [path, base] of Object.entries(state.base)) {
      if (!onDisk.has(path)) ops.push({ op: 'del', path, baseHash: base })
    }
    return ops.sort((a, b) => a.path.localeCompare(b.path))
  }

  async meta(path: string): Promise<FileRecord | undefined> {
    const state = await this.load()
    const file = (await this.bridge.list()).find((f) => f.path === path)
    if (!file) {
      const base = state.base[path]
      if (!base) return undefined
      // Tracked but gone from disk: a delete waiting to be pushed.
      return { path, hash: '', size: 0, mtime: 0, baseHash: base, deleted: true }
    }
    return { ...file, baseHash: state.base[path] ?? '', deleted: false }
  }

  async applyRemote(path: string, data: Uint8Array, hash: string): Promise<void> {
    await this.bridge.write(path, data)
    const state = await this.load()
    state.base[path] = hash || (await sha256Hex(data))
    await this.persist()
  }

  async removeRemote(path: string): Promise<void> {
    await this.bridge.remove(path)
    const state = await this.load()
    delete state.base[path]
    await this.persist()
  }

  async markPushed(path: string, hash: string): Promise<void> {
    const state = await this.load()
    state.base[path] = hash
    await this.persist()
  }

  async forget(path: string): Promise<void> {
    const state = await this.load()
    delete state.base[path]
    await this.persist()
  }

  async cursor(): Promise<number> {
    return (await this.load()).cursor
  }

  async setCursor(seq: number): Promise<void> {
    ;(await this.load()).cursor = seq
    await this.persist()
  }

  async flag(key: string): Promise<string | undefined> {
    return (await this.load()).flags[key] || undefined
  }

  async setFlag(key: string, value: string): Promise<void> {
    ;(await this.load()).flags[key] = value
    await this.persist()
  }

  async clear(): Promise<void> {
    this.state = emptyState()
    await this.persist()
  }
}
