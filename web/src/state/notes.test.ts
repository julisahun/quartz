import { describe, expect, it } from 'vitest'
import {
  humanSize,
  isConflictCopy,
  isNote,
  isOpenable,
  isPdf,
  mimeType,
  noteTitle,
  pathForTitle,
  resolveWikilink,
  uniquePath,
} from './notes'

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

describe('resolving a link to a file that is not a note', () => {
  const vault = [
    { path: 'notes/Pi setup.md', hash: '', size: 0, mtime: 0 },
    { path: 'assets/carta-tulio.pdf', hash: '', size: 0, mtime: 0 },
    { path: 'attachments/diagram.png', hash: '', size: 0, mtime: 0 },
  ]

  it('finds a file by its own name, wherever it is filed', () => {
    // What Obsidian writes, and what the .md-appending rules found nothing for.
    expect(resolveWikilink('carta-tulio.pdf', vault)).toBe('assets/carta-tulio.pdf')
    expect(resolveWikilink('diagram.png', vault)).toBe('attachments/diagram.png')
  })

  it('still finds it by its path, and is not case-fussy', () => {
    expect(resolveWikilink('assets/carta-tulio.pdf', vault)).toBe('assets/carta-tulio.pdf')
    expect(resolveWikilink('CARTA-TULIO.PDF', vault)).toBe('assets/carta-tulio.pdf')
  })

  it('lets a note win a name it could answer to', () => {
    const both = [
      { path: 'Acto 3.1.md', hash: '', size: 0, mtime: 0 },
      { path: 'old/Acto 3.1', hash: '', size: 0, mtime: 0 },
    ]
    expect(resolveWikilink('Acto 3.1', both)).toBe('Acto 3.1.md')
  })

  it('finds nothing for a file the vault does not have', () => {
    expect(resolveWikilink('missing.pdf', vault)).toBeUndefined()
  })
})

describe('files that are not notes', () => {
  it('knows a PDF from a note, whatever the case', () => {
    expect(isPdf('mundo/talasia-carta.PDF')).toBe(true)
    expect(isPdf('notes/pdf.md')).toBe(false)
    expect(isNote('mundo/talasia-carta.pdf')).toBe(false)
  })

  it('offers notes and PDFs, and nothing else', () => {
    expect(isOpenable('a/note.md')).toBe(true)
    expect(isOpenable('mundo/carta.pdf')).toBe(true)
    expect(isOpenable('attachments/20260906-shot.png')).toBe(false)
    expect(isOpenable('.obsidian/app.json')).toBe(false)
  })

  it('keeps a PDFs extension in its name — it is part of the name', () => {
    expect(noteTitle('mundo/talasia-carta.pdf')).toBe('talasia-carta.pdf')
    expect(noteTitle('objects/acero.md')).toBe('acero')
  })

  it('names the type a browser needs to be told', () => {
    expect(mimeType('a/carta.pdf')).toBe('application/pdf')
    expect(mimeType('a/shot.PNG')).toBe('image/png')
    expect(mimeType('a/whatever.bin')).toBe('application/octet-stream')
  })

  it('says a size the way a person would', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(1024)).toBe('1.0 KB')
    expect(humanSize(1_887_436)).toBe('1.8 MB')
    expect(humanSize(52_428_800)).toBe('50 MB')
  })
})
