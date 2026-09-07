import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError, OfflineError } from '../api/client'
import { IdbVaultStore } from '../vault/idb-store'
import { decodeText, encodeText } from '../vault/types'
import { SyncEngine, type SyncNotice } from './engine'
import { FakeApi, FakeServer } from './fake-server'
import type { VaultApi } from '../api/client'

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

  it('applies every page of a journal it is far behind', async () => {
    const laptop = new Device(server, 'laptop')
    const phone = new Device(server, 'phone')
    // Small enough to page, which the real server does at 5000 entries.
    phone.api.pageLimit = 2
    await phone.engine.sync()

    for (let i = 0; i < 6; i++) {
      await laptop.write(`note-${i}.md`, `# ${i}\n`)
    }
    await laptop.engine.sync()

    await phone.engine.sync()
    expect(await phone.paths()).toHaveLength(6)
    expect(await phone.read('note-5.md')).toBe('# 5\n')
  })

  it('does not strand a file whose only journal entry is past the first page', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('early.md', 'v1\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    phone.api.pageLimit = 2
    await phone.engine.sync()

    // Three entries behind a page that holds two: an edit inside the first
    // page, then a create and a delete outside it.
    await laptop.write('early.md', 'v2\n')
    await laptop.write('filler.md', 'x\n')
    await laptop.write('late.md', 'only entry is past the page\n')
    await laptop.engine.sync()

    await phone.engine.sync()
    expect(await phone.read('early.md')).toBe('v2\n')
    expect(await phone.read('late.md')).toBe('only entry is past the page\n')
  })

  it('pulls a delete that lands past the first page', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('doomed.md', 'v1\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    phone.api.pageLimit = 1
    await phone.engine.sync()
    expect(await phone.paths()).toEqual(['doomed.md'])

    await laptop.write('filler.md', 'x\n')
    await laptop.engine.sync()
    await server.delete('doomed.md', (await laptop.store.meta('doomed.md'))!.hash)

    await phone.engine.sync()
    expect(await phone.paths()).toEqual(['filler.md'])
  })

  it('repairs a device an older client left with a journal gap', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('kept.md', 'current\n')
    await laptop.write('stale.md', 'v1\n')
    await laptop.write('ghost.md', 'doomed\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()
    expect(await phone.paths()).toHaveLength(3)

    // The laptop edits one note, adds another, and deletes a third.
    await laptop.write('stale.md', 'v2\n')
    await laptop.write('fresh.md', 'new\n')
    const doomed = (await laptop.store.meta('ghost.md'))!.hash
    await laptop.engine.sync()
    await server.delete('ghost.md', doomed)

    // What the old cursor bug left behind: caught up by its own reckoning,
    // with those entries never applied and no repair marker.
    await phone.store.setCursor(server.head())
    await phone.store.setFlag('repair', '')

    const stats = await phone.engine.sync()
    expect(await phone.read('stale.md')).toBe('v2\n')
    expect(await phone.read('fresh.md')).toBe('new\n')
    expect(await phone.read('kept.md')).toBe('current\n')
    expect(await phone.paths()).not.toContain('ghost.md')
    // Repairing is not a conflict: nothing local was at stake.
    expect(stats.conflicts).toBe(0)
    expect((await phone.paths()).some((p) => p.includes('conflict'))).toBe(false)
  })

  it('repairs once, not on every sync', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('a.md', 'one\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()
    const snapshots = () => phone.api.snapshots
    const before = snapshots()
    await phone.engine.sync()
    await phone.engine.sync()
    expect(snapshots()).toBe(before)
  })

  it('leaves an out-of-date file alone rather than copying it aside', async () => {
    // The shape a rebuilt index used to hit: the phone is clean but behind, so
    // there is nothing of its own to preserve.
    const laptop = new Device(server, 'laptop')
    await laptop.write('note.md', 'v1\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()

    await server.rebuildIndex() // index.sqlite deleted on the Pi, then a rescan
    await server.writeExternally('note.md', 'v2\n') // Obsidian, after the rescan

    const stats = await phone.engine.sync()
    expect(await phone.read('note.md')).toBe('v2\n')
    expect(await phone.paths()).toEqual(['note.md'])
    expect(stats.conflicts).toBe(0)
  })

  it('keeps a pending delete across a rebuilt index', async () => {
    const laptop = new Device(server, 'laptop')
    await laptop.write('bye.md', 'v1\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()
    await phone.store.delete('bye.md') // deleted here, not yet pushed

    await server.rebuildIndex()
    await phone.engine.sync()

    expect(await phone.paths()).toEqual([])
    expect(server.files.has('bye.md')).toBe(false)
  })

  it('does not empty a device because the server answered with nothing', async () => {
    // A vault whose disk failed to mount on the Pi: the directory is recreated
    // empty, so the manifest lists nothing. Trusting that would delete a
    // folder-backed vault off the user's own machine.
    const laptop = new Device(server, 'laptop')
    await laptop.write('a.md', 'one\n')
    await laptop.write('b.md', 'two\n')
    await laptop.engine.sync()

    const phone = new Device(server, 'phone')
    await phone.engine.sync()
    expect(await phone.paths()).toHaveLength(2)

    server.files.clear()
    await phone.store.setFlag('repair', '') // force the repair pass
    await phone.engine.sync()

    expect(await phone.paths()).toEqual(['a.md', 'b.md'])
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

describe('a transport that loses hashes', () => {
  /**
   * Stands in for a proxy that drops the ETag header, which is how the first
   * real device to sync through Cloudflare ended up creating a conflict copy
   * of every note it had just downloaded.
   */
  class HashlessApi implements VaultApi {
    constructor(private readonly inner: FakeApi) {}
    snapshot = () => this.inner.snapshot()
    changes = (since: number) => this.inner.changes(since)
    putFile = (path: string, data: Uint8Array, baseHash: string) =>
      this.inner.putFile(path, data, baseHash)
    deleteFile = (path: string, baseHash: string) => this.inner.deleteFile(path, baseHash)
    search = () => this.inner.search()
    async getFile(path: string) {
      const file = await this.inner.getFile(path)
      return { data: file.data, hash: '' } // the header never arrived
    }
  }

  it('still syncs cleanly, with no conflict copies', async () => {
    const server = new FakeServer()
    await server.writeExternally('notes/one.md', 'first\n')
    await server.writeExternally('notes/two.md', 'second\n')

    const store = new IdbVaultStore(`quartz-hashless-${Date.now()}`)
    const engine = new SyncEngine(store, new HashlessApi(new FakeApi(server)), { device: 'phone' })

    await engine.sync()
    await engine.sync()
    await engine.sync()

    const paths = (await store.list()).map((f) => f.path).sort()
    expect(paths).toEqual(['notes/one.md', 'notes/two.md'])
    expect(await store.pending()).toHaveLength(0)
    expect([...server.files.keys()].sort()).toEqual(['notes/one.md', 'notes/two.md'])
  })
})
