import { describe, expect, it } from 'vitest'
import { isConflictCopy, noteTitle, pathForTitle, resolveWikilink, uniquePath } from './notes'

const files = [
  { path: 'notes/Pi setup.md', hash: '', size: 0, mtime: 0 },
  { path: 'daily/2026-09-05.md', hash: '', size: 0, mtime: 0 },
  { path: 'img/pic.png', hash: '', size: 0, mtime: 0 },
]

describe('wikilinks', () => {
  it('resolves by name, path and case', () => {
    expect(resolveWikilink('Pi setup', files)).toBe('notes/Pi setup.md')
    expect(resolveWikilink('notes/Pi setup.md', files)).toBe('notes/Pi setup.md')
    expect(resolveWikilink('pi SETUP', files)).toBe('notes/Pi setup.md')
    expect(resolveWikilink('2026-09-05', files)).toBe('daily/2026-09-05.md')
  })

  it('ignores the display text and heading anchors', () => {
    expect(resolveWikilink('Pi setup|the pi', files)).toBe('notes/Pi setup.md')
    expect(resolveWikilink('Pi setup#Ports', files)).toBe('notes/Pi setup.md')
  })

  it('returns nothing for an unknown target', () => {
    expect(resolveWikilink('does not exist', files)).toBeUndefined()
    expect(resolveWikilink('  ', files)).toBeUndefined()
  })
})

describe('paths', () => {
  it('derives a title from a path', () => {
    expect(noteTitle('notes/Pi setup.md')).toBe('Pi setup')
    expect(noteTitle('top.md')).toBe('top')
  })

  it('avoids collisions', () => {
    expect(uniquePath('notes/Pi setup.md', files)).toBe('notes/Pi setup 2.md')
    expect(uniquePath('notes/New.md', files)).toBe('notes/New.md')
  })

  it('makes a safe path from a typed title', () => {
    expect(pathForTitle('Pi / setup: notes')).toBe('Pi - setup- notes.md')
    expect(pathForTitle('Ideas', 'notes')).toBe('notes/Ideas.md')
    expect(pathForTitle('   ')).toBe('Untitled.md')
  })

  it('recognises conflict copies', () => {
    expect(isConflictCopy('todo (conflict phone 2026-09-05 143005).md')).toBe(true)
    expect(isConflictCopy('todo.md')).toBe(false)
  })
})
