import { describe, expect, it } from 'vitest'
import { rankNotes } from './quick-open'
import type { FileMeta } from '../vault/types'

const vault = (...paths: string[]): FileMeta[] =>
  paths.map((path, i) => ({ path, hash: 'h', size: 0, mtime: i }))

const paths = (query: string, files: FileMeta[]) => rankNotes(query, files).map((h) => h.path)

describe('rankNotes', () => {
  it('matches letters scattered along the path', () => {
    const files = vault('campaigns/marea-baja/objects/acero-del-manantial.md', 'other.md')
    expect(paths('mbacero', files)).toEqual(['campaigns/marea-baja/objects/acero-del-manantial.md'])
  })

  it('ignores spaces in the query', () => {
    const files = vault('campaigns/marea-baja/last.md')
    expect(paths('marea baja', files)).toHaveLength(1)
  })

  it('puts a name match above a match out in the folders', () => {
    const files = vault('pnj/ossian/notes.md', 'objects/ossian.md')
    expect(paths('ossian', files)[0]).toBe('objects/ossian.md')
  })

  it('prefers a whole word to letters picked out of one', () => {
    const files = vault('acero.md', 'a-c-e-r-o-something-else.md')
    expect(paths('acero', files)[0]).toBe('acero.md')
  })

  it('says where in the path it matched, for highlighting', () => {
    const [hit] = rankNotes('acero', vault('objects/acero.md'))
    expect(hit.matches.map((i) => 'objects/acero.md'[i]).join('')).toBe('acero')
    expect(hit.title).toBe('acero')
    expect(hit.folder).toBe('objects')
  })

  it('lists the most recently touched notes when nothing is typed', () => {
    const files = vault('old.md', 'newer.md', 'newest.md')
    expect(paths('', files)).toEqual(['newest.md', 'newer.md', 'old.md'])
  })

  it('finds nothing when a letter is missing, and skips attachments', () => {
    expect(paths('zzz', vault('acero.md'))).toEqual([])
    expect(paths('settings', vault('.obsidian/app.json'))).toEqual([])
  })

  it('finds a PDF by name, and says that is what it is', () => {
    const files = vault('runs/last/players/abraxas/abraxas-guia.pdf', 'pnj/abraxas.md')
    const [first] = rankNotes('abraxasguia', files)
    expect(first.path).toBe('runs/last/players/abraxas/abraxas-guia.pdf')
    expect(first.kind).toBe('pdf')
    expect(rankNotes('abraxas', files).every((h) => h.path.includes('abraxas'))).toBe(true)
  })

  it('finds an image by name too — a map is looked up like a handout', () => {
    const files = vault('mundo/talasia/mapa-costa.png', 'mundo/talasia.md')
    const [first] = rankNotes('mapacosta', files)
    expect(first.path).toBe('mundo/talasia/mapa-costa.png')
    expect(first.kind).toBe('image')
    // The extension is part of the name, so it survives into the title.
    expect(first.title).toBe('mapa-costa.png')
  })
})
