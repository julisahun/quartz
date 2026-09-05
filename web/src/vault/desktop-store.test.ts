import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { SyncEngine } from '../sync/engine'
import { FakeApi, FakeServer } from '../sync/fake-server'
import { DesktopVaultStore, type DesktopBridge } from './desktop-store'
import { sha256Hex } from './hash'
import { decodeText, encodeText } from './types'

/** An in-memory stand-in for a real folder on disk. */
class MemoryFolder implements DesktopBridge {
  files = new Map<string, Uint8Array>()
  private state = ''

  async list() {
    const out = []
    for (const [path, data] of this.files) {
      out.push({ path, hash: await sha256Hex(data), size: data.byteLength, mtime: 0 })
    }
    return out
  }

  async read(path: string): Promise<Uint8Array> {
    const data = this.files.get(path)
    if (!data) throw new Error(`no such file: ${path}`)
    return data
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, new Uint8Array(data))
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
  }

  async stateRead(): Promise<string> {
    return this.state
  }

  async stateWrite(json: string): Promise<void> {
    this.state = json
  }
}

describe('desktop vault store', () => {
  let folder: MemoryFolder
  let store: DesktopVaultStore
  let server: FakeServer
  let api: FakeApi
  let engine: SyncEngine

  beforeEach(() => {
    folder = new MemoryFolder()
    store = new DesktopVaultStore(folder)
    server = new FakeServer()
    api = new FakeApi(server)
    engine = new SyncEngine(store, api, { device: 'desktop' })
  })

  it('treats a file that disappeared from the folder as a pending delete', async () => {
    await store.write('note.md', encodeText('one\n'))
    await engine.sync()
    expect(server.files.has('note.md')).toBe(true)

    // Deleted in Finder, not through the app.
    folder.files.delete('note.md')
    expect(await store.pending()).toEqual([{ op: 'del', path: 'note.md', baseHash: expect.any(String) }])

    await engine.sync()
    expect(server.files.has('note.md')).toBe(false)
  })

  it('treats a file dropped into the folder as a new note', async () => {
    await engine.sync()
    folder.files.set('dropped.md', encodeText('from finder\n'))
    await engine.sync()
    expect(server.files.has('dropped.md')).toBe(true)
  })

  it('syncs the same way the browser store does', async () => {
    await store.write('a.md', encodeText('one\n'))
    await engine.sync()

    await server.writeExternally('b.md', 'two\n')
    const stats = await engine.sync()
    expect(stats.pulled).toBe(1)
    expect(decodeText(await store.read('b.md'))).toBe('two\n')

    // Conflicting edits keep both copies here too.
    await store.write('a.md', encodeText('desktop edit\n'))
    await server.writeExternally('a.md', 'server edit\n')
    const conflict = await engine.sync()
    expect(conflict.conflicts).toBe(1)
    expect(decodeText(await store.read('a.md'))).toBe('server edit\n')
    const copy = [...folder.files.keys()].find((p) => p.includes('conflict'))
    expect(copy).toBeDefined()
    expect(decodeText(await store.read(copy!))).toBe('desktop edit\n')
  })

  it('keeps sync state out of the vault folder', async () => {
    await store.write('a.md', encodeText('one\n'))
    await store.setFlag('device', 'desktop')
    await engine.sync()
    expect([...folder.files.keys()]).toEqual(['a.md'])
  })

  it('survives a lost state file by reconciling against the manifest', async () => {
    await store.write('a.md', encodeText('one\n'))
    await engine.sync()

    // The state file is gone but the folder is intact.
    await folder.stateWrite('')
    const fresh = new DesktopVaultStore(folder)
    const freshEngine = new SyncEngine(fresh, api, { device: 'desktop' })
    const stats = await freshEngine.sync()
    expect(stats.conflicts).toBe(0)
    expect(server.files.size).toBe(1)
  })

  it('keeps pending work when the session expires', async () => {
    await store.write('a.md', encodeText('one\n'))
    api.authed = false
    await expect(engine.sync()).rejects.toBeInstanceOf(ApiError)
    expect(await store.pending()).toHaveLength(1)
  })
})
