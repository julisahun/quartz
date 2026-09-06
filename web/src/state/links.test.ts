import { describe, expect, it } from 'vitest'
import { parseLinks, retargetLinks } from './links'
import { buildResolver } from './notes'
import type { FileMeta } from '../vault/types'

function meta(path: string, hash: string): FileMeta {
  return { path, hash, size: 0, mtime: 0 }
}

describe('parseLinks', () => {
  it('finds links, embeds and their line', () => {
    const refs = parseLinks('intro\nsee [[Pi setup]] and ![[diagram]]\n')
    expect(refs.map((r) => [r.target, r.line])).toEqual([
      ['Pi setup', 2],
      ['diagram', 2],
    ])
    expect(refs[0].context).toBe('see [[Pi setup]] and ![[diagram]]')
  })

  it('keeps the display and heading halves for the resolver', () => {
    expect(parseLinks('[[Pi setup|the pi]] [[Pi setup#Ports]]').map((r) => r.target)).toEqual([
      'Pi setup|the pi',
      'Pi setup#Ports',
    ])
  })

  it('ignores links inside a fenced block', () => {
    const refs = parseLinks('```\n[[not a link]]\n```\n[[real]]')
    expect(refs.map((r) => r.target)).toEqual(['real'])
  })

  it('closes a fence only on its own marker', () => {
    const refs = parseLinks('~~~\n```\n[[still code]]\n~~~\n[[out]]')
    expect(refs.map((r) => r.target)).toEqual(['out'])
  })

  it('ignores links inside an inline code span', () => {
    const refs = parseLinks('write `[[example]]` to link to [[example]]')
    expect(refs.map((r) => r.target)).toEqual(['example'])
  })

  it('does not let a link span a line', () => {
    expect(parseLinks('[[open\nclose]]')).toEqual([])
  })

  it('starts at the inner brackets when one is left open', () => {
    // What the editor's parser does too: it gives up at the stray "[" and
    // tries again from the next position, so the link here is [[b]].
    expect(parseLinks('[[a [[b]]').map((r) => r.target)).toEqual(['b'])
  })
})

describe('retargetLinks', () => {
  /** Rewrites against a vault holding exactly `paths`. */
  function rename(
    text: string,
    from: string,
    to: string,
    paths: string[] = [from],
    shortNameWorks = true,
  ) {
    const resolve = buildResolver(paths.map((p) => meta(p, 'h')))
    return retargetLinks(text, { resolve, from, to, shortNameWorks })
  }

  it('keeps a bare name bare', () => {
    const out = rename('see [[Pi setup]] today', 'Pi setup.md', 'Raspberry Pi.md')
    expect(out.text).toBe('see [[Raspberry Pi]] today')
    expect(out.changed).toBe(1)
  })

  it('keeps a path a path, and an extension an extension', () => {
    expect(rename('[[notes/Pi setup.md]]', 'notes/Pi setup.md', 'notes/Pi.md').text).toBe(
      '[[notes/Pi.md]]',
    )
    expect(rename('[[notes/Pi setup]]', 'notes/Pi setup.md', 'notes/Pi.md').text).toBe(
      '[[notes/Pi]]',
    )
  })

  it('keeps the heading, the display text and the embed', () => {
    const out = rename(
      '![[Pi setup]] [[Pi setup#Ports]] [[Pi setup|the pi]] [[Pi setup#Ports|ports]]',
      'Pi setup.md',
      'Pi.md',
    )
    expect(out.text).toBe('![[Pi]] [[Pi#Ports]] [[Pi|the pi]] [[Pi#Ports|ports]]')
    expect(out.changed).toBe(4)
  })

  it('widens to the full path when the new name is ambiguous', () => {
    // Another "Pi.md" already exists, so [[Pi]] would land on a stranger.
    const out = rename(
      'see [[Pi setup]]',
      'notes/Pi setup.md',
      'notes/Pi.md',
      ['notes/Pi setup.md', 'archive/Pi.md'],
      false,
    )
    expect(out.text).toBe('see [[notes/Pi]]')
  })

  it('leaves other notes, code fences and inline code alone', () => {
    const source = [
      '[[Pi setup]] and [[Something else]]',
      '```',
      '[[Pi setup]]',
      '```',
      'literally `[[Pi setup]]` here',
    ].join('\n')
    const out = rename(source, 'Pi setup.md', 'Pi.md', ['Pi setup.md', 'Something else.md'])
    expect(out.text.split('\n')).toEqual([
      '[[Pi]] and [[Something else]]',
      '```',
      '[[Pi setup]]',
      '```',
      'literally `[[Pi setup]]` here',
    ])
    expect(out.changed).toBe(1)
  })

  it('rewrites every mention, on one line or many', () => {
    const out = rename('[[Pi setup]] then [[pi setup]]\nand [[Pi setup]]', 'Pi setup.md', 'Pi.md')
    expect(out.text).toBe('[[Pi]] then [[Pi]]\nand [[Pi]]')
    expect(out.changed).toBe(3)
  })

  it('touches nothing when no link points at the note', () => {
    const source = 'nothing to see, only [[Other]]'
    const out = rename(source, 'Pi setup.md', 'Pi.md', ['Pi setup.md', 'Other.md'])
    expect(out.text).toBe(source)
    expect(out.changed).toBe(0)
  })

  it('leaves the rest of the line, and the line endings, exactly as they were', () => {
    const out = rename('a [[Pi setup]] b\r\nc\n', 'Pi setup.md', 'Pi.md')
    expect(out.text).toBe('a [[Pi]] b\r\nc\n')
  })
})
