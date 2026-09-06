import { describe, expect, it } from 'vitest'
import { folderOps } from './fsa-bridge'
import { decodeText, encodeText } from './types'

/**
 * A directory tree standing in for the File System Access API. Only the parts
 * the bridge actually calls, so a missing method is a test failure rather than
 * a silent pass.
 */
class FakeFile {
  readonly kind = 'file'
  reads = 0
  constructor(
    readonly name: string,
    public data: Uint8Array,
    public lastModified = 1000,
  ) {}

  async getFile() {
    const self = this
    return {
      size: self.data.length,
      lastModified: self.lastModified,
      async arrayBuffer() {
        self.reads++
        return self.data.slice().buffer
      },
    } as unknown as File
  }

  async createWritable() {
    const staged: Uint8Array[] = []
    let closed = false
    return {
      write: async (chunk: Uint8Array) => {
        if (closed) throw new Error('written after close')
        staged.push(chunk)
      },
      close: async () => {
        closed = true
        // The real API swaps the staged bytes in on close, never before.
        this.data = new Uint8Array(staged.flatMap((c) => [...c]))
        this.lastModified += 1
      },
    } as unknown as FileSystemWritableFileStream
  }
}

class FakeDir {
  readonly kind = 'directory'
  readonly children = new Map<string, FakeDir | FakeFile>()
  constructor(readonly name = '') {}

  async *entries(): AsyncGenerator<[string, FakeDir | FakeFile]> {
    for (const entry of [...this.children.entries()]) yield entry
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDir> {
    const found = this.children.get(name)
    if (found instanceof FakeDir) return found
    if (found) throw new DOMException(`${name} is a file`, 'TypeMismatchError')
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const dir = new FakeDir(name)
    this.children.set(name, dir)
    return dir
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFile> {
    const found = this.children.get(name)
    if (found instanceof FakeFile) return found
    if (found) throw new DOMException(`${name} is a directory`, 'TypeMismatchError')
    if (!options?.create) throw new DOMException(`${name} not found`, 'NotFoundError')
    const file = new FakeFile(name, new Uint8Array())
    this.children.set(name, file)
    return file
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new DOMException(`${name} not found`, 'NotFoundError')
  }
}

/** Builds a tree from `path -> contents`, creating directories as needed. */
function tree(files: Record<string, string>): FakeDir {
  const root = new FakeDir()
  for (const [path, text] of Object.entries(files)) {
    const segments = path.split('/')
    const name = segments.pop() as string
    let dir = root
    for (const segment of segments) {
      const next = dir.children.get(segment)
      if (next instanceof FakeDir) dir = next
      else {
        const made = new FakeDir(segment)
        dir.children.set(segment, made)
        dir = made
      }
    }
    dir.children.set(name, new FakeFile(name, encodeText(text)))
  }
  return root
}

function opsOver(root: FakeDir) {
  return folderOps(async () => root as unknown as FileSystemDirectoryHandle)
}

describe('a folder opened in the browser', () => {
  it('lists notes and attachments, sorted, and leaves the rest out', async () => {
    const root = tree({
      'b.md': 'b',
      'notes/a.md': 'a',
      'img/pic.png': 'p',
      '.obsidian/app.json': '{}',
      '.obsidian/workspace.json': '{}',
      '.DS_Store': 'junk',
      '.git/config': 'junk',
    })
    const files = await opsOver(root).list()
    expect(files.map((f) => f.path)).toEqual([
      '.obsidian/app.json',
      'b.md',
      'img/pic.png',
      'notes/a.md',
    ])
  })

  it('hashes the same way the server does', async () => {
    const files = await opsOver(tree({ 'a.md': 'hello' })).list()
    // sha256("hello") — the value Go, Rust and the browser all produce.
    expect(files[0].hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })

  it('re-reads a file only when its size or mtime has moved', async () => {
    const root = tree({ 'a.md': 'hello' })
    const file = root.children.get('a.md') as FakeFile
    const ops = opsOver(root)

    await ops.list()
    await ops.list()
    expect(file.reads).toBe(1)

    // Something else edited it: a new mtime is enough to make us look again.
    file.lastModified += 1
    await ops.list()
    expect(file.reads).toBe(2)
  })

  it('reads and writes through nested folders, creating them on the way', async () => {
    const root = tree({})
    const ops = opsOver(root)
    await ops.write('daily/2026/note.md', encodeText('# hi'))
    expect(decodeText(await ops.read('daily/2026/note.md'))).toBe('# hi')
    expect((await ops.list()).map((f) => f.path)).toEqual(['daily/2026/note.md'])
  })

  it('replaces a note without ever leaving half of one behind', async () => {
    const root = tree({ 'a.md': 'before' })
    const file = root.children.get('a.md') as FakeFile
    await opsOver(root).write('a.md', encodeText('after'))
    expect(decodeText(file.data)).toBe('after')
  })

  it('deletes a note and takes the folders it emptied with it', async () => {
    const root = tree({ 'daily/2026/note.md': 'x', 'daily/keep.md': 'y' })
    const ops = opsOver(root)
    await ops.remove('daily/2026/note.md')
    expect((await ops.list()).map((f) => f.path)).toEqual(['daily/keep.md'])
    // The emptied year is gone; the folder still holding a note is not.
    expect((root.children.get('daily') as FakeDir).children.has('2026')).toBe(false)
    expect(root.children.has('daily')).toBe(true)
  })

  it('treats a note that is already gone as deleted', async () => {
    const ops = opsOver(tree({ 'a.md': 'x' }))
    await expect(ops.remove('nothing/here.md')).resolves.toBeUndefined()
    await expect(ops.remove('a.md')).resolves.toBeUndefined()
    expect(await ops.list()).toEqual([])
  })
})
