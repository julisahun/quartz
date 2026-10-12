import { describe, expect, it } from 'vitest'
import { nothingWritten } from './NoteEditor'

describe('whether a note opens ready to type', () => {
  it('does for a new note: a heading and nothing else', () => {
    expect(nothingWritten('# Groceries\n\n')).toBe(true)
  })

  it('does for a fresh daily note: frontmatter and a heading', () => {
    expect(nothingWritten('---\ndate: 2026-10-12\n---\n\n# Monday, 12 October 2026\n\n')).toBe(true)
  })

  it('does for an empty file', () => {
    expect(nothingWritten('')).toBe(true)
  })

  it('does not once something is written, so it opens rendered', () => {
    expect(nothingWritten('# Groceries\n\n- figs\n')).toBe(false)
    expect(nothingWritten('Just a line, no heading.')).toBe(false)
  })
})
