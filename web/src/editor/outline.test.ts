import { describe, expect, it } from 'vitest'
import { headings } from './outline'

describe('headings', () => {
  it('lists the headings with their level and line', () => {
    expect(headings('# Title\n\ntext\n## Part one ##\n### Deeper')).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Part one', line: 4 },
      { level: 3, text: 'Deeper', line: 5 },
    ])
  })

  it('skips what only looks like a heading inside a code block', () => {
    expect(headings('# Real\n```sh\n# a comment\n```\n## Also real').map((h) => h.text)).toEqual([
      'Real',
      'Also real',
    ])
  })

  it('skips front matter, and a hashtag that is not a heading', () => {
    expect(headings('---\ntitle: x\n---\n#tag\n# Heading').map((h) => h.line)).toEqual([5])
  })
})
