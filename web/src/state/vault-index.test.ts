import { describe, expect, it } from 'vitest'
import { VaultIndex, sameTags } from './vault-index'
import type { FileMeta } from '../vault/types'
import { encodeText } from '../vault/types'

function meta(path: string, hash: string): FileMeta {
  return { path, hash, size: 0, mtime: 0 }
}

/** A vault made of literal note bodies, hashed by their own text. */
function vault(notes: Record<string, string>) {
  const files = Object.entries(notes).map(([path, body]) => meta(path, `h:${body}`))
  const read = async (path: string) => {
    const body = notes[path]
    if (body === undefined) throw new Error(`no such file: ${path}`)
    return encodeText(body)
  }
  return { files, read }
}

describe('VaultIndex', () => {
  it('lists the notes pointing at a note, with their line', async () => {
    const { files, read } = vault({
      'daily/Monday.md': 'ran through [[Pi setup]]',
      'notes/Ideas.md': 'maybe\n\nsee [[pi setup]] again',
      'notes/Pi setup.md': '# Pi setup',
    })
    const index = new VaultIndex()
    await index.rebuild(files, read)

    // Sorted by title, so the list does not reshuffle as files change.
    expect(index.to('notes/Pi setup.md')).toEqual([
      { path: 'notes/Ideas.md', title: 'Ideas', line: 3, context: 'see [[pi setup]] again' },
      { path: 'daily/Monday.md', title: 'Monday', line: 1, context: 'ran through [[Pi setup]]' },
    ])
  })

  it('counts two links on one line once, and two lines twice', async () => {
    const { files, read } = vault({
      'A.md': '[[B]] and [[B]] again\nand [[B]] below',
      'B.md': '',
    })
    const index = new VaultIndex()
    await index.rebuild(files, read)
    expect(index.to('B.md').map((b) => b.line)).toEqual([1, 2])
  })

  it('ignores self-links and links to attachments', async () => {
    const { files, read } = vault({
      'A.md': 'about [[A]] and ![[logo.png]]',
      'attachments/logo.png': 'PNG',
    })
    const index = new VaultIndex()
    await index.rebuild(files, read)
    expect(index.to('A.md')).toEqual([])
    expect(index.to('attachments/logo.png')).toEqual([])
  })

  it('re-reads only the notes whose hash moved', async () => {
    const notes: Record<string, string> = { 'A.md': '[[B]]', 'B.md': '', 'C.md': 'nothing' }
    const reads: string[] = []
    const read = async (path: string) => {
      reads.push(path)
      return encodeText(notes[path])
    }
    const filesOf = () => Object.entries(notes).map(([p, b]) => meta(p, `h:${b}`))

    const index = new VaultIndex()
    await index.rebuild(filesOf(), read)
    expect(reads).toEqual(['A.md', 'B.md', 'C.md'])

    reads.length = 0
    notes['C.md'] = 'now [[B]] too'
    await index.rebuild(filesOf(), read)
    expect(reads).toEqual(['C.md'])
    expect(index.to('B.md').map((b) => b.path)).toEqual(['A.md', 'C.md'])
  })

  it('drops a note that has gone away', async () => {
    const notes: Record<string, string> = { 'A.md': '[[B]]', 'B.md': '' }
    const filesOf = () => Object.entries(notes).map(([p, b]) => meta(p, `h:${b}`))
    const read = async (path: string) => encodeText(notes[path])

    const index = new VaultIndex()
    await index.rebuild(filesOf(), read)
    expect(index.to('B.md')).toHaveLength(1)

    delete notes['A.md']
    await index.rebuild(filesOf(), read)
    expect(index.to('B.md')).toEqual([])
  })

  it('resolves links written before their target existed', async () => {
    const notes: Record<string, string> = { 'A.md': 'see [[Later]]' }
    const filesOf = () => Object.entries(notes).map(([p, b]) => meta(p, `h:${b}`))
    const read = async (path: string) => encodeText(notes[path])

    const index = new VaultIndex()
    await index.rebuild(filesOf(), read)
    expect(index.to('Later.md')).toEqual([])

    notes['Later.md'] = '# Later'
    await index.rebuild(filesOf(), read)
    expect(index.to('Later.md').map((b) => b.path)).toEqual(['A.md'])
  })

  it('survives a note that is listed but not stored on this device', async () => {
    const files = [meta('A.md', 'h1'), meta('B.md', 'h2')]
    const read = async (path: string) => {
      if (path === 'A.md') throw new Error('evicted')
      return encodeText('[[A]]')
    }
    const index = new VaultIndex()
    await index.rebuild(files, read)
    expect(index.to('A.md').map((b) => b.path)).toEqual(['B.md'])
  })
})

describe('VaultIndex tags', () => {
  it('collects inline tags and the notes carrying them', async () => {
    const { files, read } = vault({
      'objects/Acero.md': '# Acero\n\n#objeto #sequia\n',
      'pnj/Ossian.md': '#pnj #sequia',
      'plain.md': 'no tags here',
    })
    const index = new VaultIndex()
    await index.rebuild(files, read)

    expect(index.allTags().map((t) => t.tag)).toEqual(['objeto', 'pnj', 'sequia'])
    expect(index.taggedWith('sequia')).toEqual(['objects/Acero.md', 'pnj/Ossian.md'])
  })

  it('reads tags out of the frontmatter too', async () => {
    const { files, read } = vault({
      'A.md': '---\ntags: [pnj, roquena]\n---\n\nbody',
      'B.md': '---\ntags:\n  - pnj\n---\n',
    })
    const index = new VaultIndex()
    await index.rebuild(files, read)
    expect(index.taggedWith('pnj')).toEqual(['A.md', 'B.md'])
    expect(index.taggedWith('roquena')).toEqual(['A.md'])
  })

  it('matches a parent tag against the tags nested under it', async () => {
    const { files, read } = vault({ 'A.md': '#pnj/roquena', 'B.md': '#pnj' })
    const index = new VaultIndex()
    await index.rebuild(files, read)
    expect(index.taggedWith('pnj')).toEqual(['B.md', 'A.md'])
    expect(index.taggedWith('pnj/roquena')).toEqual(['A.md'])
  })

  it('drops the tags of a note that has gone away', async () => {
    const notes: Record<string, string> = { 'A.md': '#gone' }
    const filesOf = () => Object.entries(notes).map(([p, b]) => meta(p, `h:${b}`))
    const read = async (path: string) => encodeText(notes[path])

    const index = new VaultIndex()
    await index.rebuild(filesOf(), read)
    expect(index.taggedWith('gone')).toEqual(['A.md'])

    delete notes['A.md']
    await index.rebuild(filesOf(), read)
    expect(index.allTags()).toEqual([])
  })

  it('knows when the tag list has not moved', () => {
    const a = [{ tag: 'pnj', key: 'pnj', paths: ['A.md'] }]
    expect(sameTags(a, [{ tag: 'pnj', key: 'pnj', paths: ['A.md'] }])).toBe(true)
    expect(sameTags(a, [{ tag: 'pnj', key: 'pnj', paths: ['A.md', 'B.md'] }])).toBe(false)
  })
})
