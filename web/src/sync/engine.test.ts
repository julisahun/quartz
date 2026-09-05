import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, OfflineError } from '../api/client'
import { IdbVaultStore } from '../vault/idb-store'
import { decodeText, encodeText } from '../vault/types'
import { SyncEngine, type SyncNotice } from './engine'
import { FakeApi, FakeServer } from './fake-server'

let dbCounter = 0

/** One device: its own local store, its own connection, its own engine. */
class Device {
  readonly store: IdbVaultStore
  readonly api: FakeApi
  readonly engine: SyncEngine
  readonly notices: SyncNotice[] = []

  constructor(server: FakeServer, readonly name: string) {
    // A separate database per device is what separate devices actually are.
    this.store = new IdbVaultStore(`quartz-test-${++dbCounter}`)
    this.api = new FakeApi(server)
    this.engine = new SyncEngine(this.store, this.api, {
      device: name,
      onNotice: (n) => this.notices.push(n),
    })
  }

  async write(path: string, text: string): Promise<void> {
    await this.store.write(path, encodeText(text))
  }

  async read(path: string): Promise<string> {
    return decodeText(await this.store.read(path))
  }

  async paths(): Promise<string[]> {
    return (await this.store.list()).map((f) => f.path)
  }
}

describe('sync engine', () => {
  let server: FakeServer

  beforeEach(() => {
    server = new FakeServer()
  })

  it('pushes a new note and pulls it on another device', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('notes/todo.md', '- milk\n')
    expect(await laptop.engine.sync()).toMatchObject({ pushed: 1, conflicts: 0 })

    const phone = new Device(server, 'phone')
    expect(await phone.engine.sync()).toMatchObject({ pulled: 1 })
    expect(await phone.read('notes/todo.md')).toBe('- milk\n')
  })

  it('keeps both versions when two devices edit the same note', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('todo.md', 'shared base\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()

    // The phone edits offline and cannot push.
    phone.api.online = false
    await phone.write('todo.md', 'phone version\n')
    await expect(phone.engine.sync()).rejects.toBeInstanceOf(OfflineError)

    // Meanwhile the note moves on at the server.
    await server.writeExternally('todo.md', 'laptop version\n')

    // The phone reconnects and must not lose its edit.
    phone.api.online = true
    const stats = await phone.engine.sync()
    expect(stats.conflicts).toBe(1)

    expect(await phone.read('todo.md')).toBe('laptop version\n')
    const copy = (await phone.paths()).find((p) => p.includes('conflict'))
    expect(copy).toBeDefined()
    expect(await phone.read(copy!)).toBe('phone version\n')
    expect(copy).toMatch(/^todo \(conflict phone \d{4}-\d{2}-\d{2} \d{6}\)\.md$/)
    // The copy reaches the server too, so it shows up in Obsidian.
    expect(server.files.has(copy!)).toBe(true)
    expect(phone.notices.some((n) => n.kind === 'conflict')).toBe(true)
  })

  it('never drops pending work when the session expires', async () => {
    // The unforgivable bug: a 401 mid-sync must not lose unsent edits.
    const laptop = new Device(server, 'laptop')
    await laptop.write('important.md', 'a thought worth keeping\n')

    laptop.api.authed = false
    await expect(laptop.engine.sync()).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.isAuth,
    )
    expect(await laptop.store.pending()).toHaveLength(1)
    expect(await laptop.read('important.md')).toBe('a thought worth keeping\n')

    laptop.api.authed = true
    expect(await laptop.engine.sync()).toMatchObject({ pushed: 1 })
    expect(await laptop.store.pending()).toHaveLength(0)
  })

  it('keeps offline edits queued until the network returns', async () => {
    const laptop = new Device(server, 'laptop')
    laptop.api.online = false
    await laptop.write('offline.md', 'written on a train\n')
    await expect(laptop.engine.sync()).rejects.toBeInstanceOf(OfflineError)
    expect(await laptop.store.pending()).toHaveLength(1)

    laptop.api.online = true
    expect(await laptop.engine.sync()).toMatchObject({ pushed: 1 })
    expect(server.files.has('offline.md')).toBe(true)
  })

  it('pulls a write made directly in the vault by Obsidian', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.engine.sync()
    await server.writeExternally('from-obsidian.md', 'typed elsewhere\n')

    expect(await laptop.engine.sync()).toMatchObject({ pulled: 1 })
    expect(await laptop.read('from-obsidian.md')).toBe('typed elsewhere\n')
  })

  it('propagates a delete and lets an edit beat one', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('gone.md', 'temporary\n')
    await laptop.write('stays.md', 'keep\n')
    await laptop.engine.sync()

    await laptop.store.delete('gone.md')
    expect(await laptop.engine.sync()).toMatchObject({ deleted: 1 })
    expect(server.files.has('gone.md')).toBe(false)

    // Someone edits a note we are deleting: the note comes back.
    await server.writeExternally('stays.md', 'edited elsewhere\n')
    await laptop.store.delete('stays.md')
    const stats = await laptop.engine.sync()
    expect(stats.conflicts).toBe(1)
    expect(await laptop.read('stays.md')).toBe('edited elsewhere\n')
    expect(laptop.notices.some((n) => n.kind === 'restored')).toBe(true)
  })

  it('restores a note deleted elsewhere but edited here', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('note.md', 'original\n')
    await laptop.engine.sync()

    // Deleted on the server, edited locally before the delete was pulled.
    server.files.delete('note.md')
    server.changes.push({ seq: 999, path: 'note.md', op: 'del', ts: Date.now() })
    await laptop.write('note.md', 'edited here\n')

    await laptop.engine.sync()
    expect(await laptop.read('note.md')).toBe('edited here\n')
    expect(server.files.get('note.md')).toBeDefined()
  })

  it('is idempotent', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('a.md', 'one\n')
    await laptop.engine.sync()
    for (let i = 0; i < 3; i++) {
      expect(await laptop.engine.sync()).toEqual({ pulled: 0, pushed: 0, deleted: 0, conflicts: 0 })
    }
  })

  it('recovers when the server rebuilds its index', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('a.md', 'one\n')
    await laptop.engine.sync()

    await server.rebuildIndex() // index.sqlite deleted on the Pi, then a rescan
    await server.writeExternally('b.md', 'two\n')

    await laptop.engine.sync()
    expect(await laptop.read('b.md')).toBe('two\n')
    expect(laptop.notices.some((n) => n.kind === 'reset')).toBe(true)
  })

  it('adopts identical files without a conflict on first sync', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('same.md', 'identical\n')
    await laptop.engine.sync()

    const desktop = new Device(server, 'desktop')
    await desktop.write('same.md', 'identical\n')
    expect(await desktop.engine.sync()).toMatchObject({ conflicts: 0 })
    expect(await desktop.paths()).toEqual(['same.md'])
  })

  it('keeps both when a fresh device holds a different file at the same path', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('same.md', 'server side\n')
    await laptop.engine.sync()

    const desktop = new Device(server, 'desktop')
    await desktop.write('same.md', 'local side\n')
    expect(await desktop.engine.sync()).toMatchObject({ conflicts: 1 })
    expect(await desktop.read('same.md')).toBe('server side\n')
    const copy = (await desktop.paths()).find((p) => p.includes('conflict'))
    expect(await desktop.read(copy!)).toBe('local side\n')
  })

  it('syncs attachments as bytes, unchanged', async () => {
    const laptop = new Device(server, 'laptop')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
    await laptop.store.write('img/pasted.png', png)
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()
    expect(await phone.store.read('img/pasted.png')).toEqual(png)
  })
})
