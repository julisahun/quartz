import { describe, expect, it } from 'vitest'
import { parseTags, tagMatches } from './tags'

const tagsIn = (text: string) => parseTags(text).map((t) => t.tag)

describe('parseTags', () => {
  it('finds tags at the start of a line and after a space', () => {
    expect(tagsIn('# Acero\n\n#objeto #sequia\n')).toEqual(['objeto', 'sequia'])
  })

  it('takes accents, nesting and underscores', () => {
    expect(tagsIn('#sequía #pnj/roquena #un_tag')).toEqual(['sequía', 'pnj/roquena', 'un_tag'])
  })

  it('is not a heading', () => {
    expect(tagsIn('# Title\n## Subtitle')).toEqual([])
  })

  it('is not the anchor half of a url or a link', () => {
    expect(tagsIn('see https://example.com/#anchor and [text](#heading)')).toEqual([])
  })

  it('is not a number', () => {
    expect(tagsIn('issue #1 and #2026')).toEqual([])
  })

  it('is not in the middle of a word', () => {
    expect(tagsIn('C#, F# and a#b')).toEqual([])
  })

  it('skips code, like links do', () => {
    expect(tagsIn('```\n#fenced\n```\nwrite `#inline` for a tag, e.g. #real')).toEqual(['real'])
  })

  it('reads the frontmatter properly instead of scanning it', () => {
    // The "#" of a colour in the frontmatter is not a tag; the tags: property is.
    const text = '---\ncolor: "#ff0000"\ntags: [pnj]\n---\n\n#objeto'
    expect(tagsIn(text)).toEqual(['pnj', 'objeto'])
  })

  it('reports the line a tag sits on', () => {
    expect(parseTags('one\n\n#dos\n')).toEqual([{ tag: 'dos', line: 3 }])
  })
})

describe('tagMatches', () => {
  it('matches itself, its children and nothing else', () => {
    expect(tagMatches('pnj', 'pnj')).toBe(true)
    expect(tagMatches('PNJ', 'pnj')).toBe(true)
    expect(tagMatches('pnj/roquena', 'pnj')).toBe(true)
    expect(tagMatches('pnj', 'pnj/roquena')).toBe(false)
    expect(tagMatches('pnjs', 'pnj')).toBe(false)
  })
})
