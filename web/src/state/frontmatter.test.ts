import { describe, expect, it } from 'vitest'
import { frontmatterRange, frontmatterTags, parseFrontmatter } from './frontmatter'

describe('frontmatterRange', () => {
  it('covers the block, fences included', () => {
    const text = '---\nid: x\n---\n\n# Title'
    expect(frontmatterRange(text)).toEqual({ from: 0, to: 13 })
    expect(text.slice(0, 13)).toBe('---\nid: x\n---')
  })

  it('is nothing until the block is closed', () => {
    // Halfway through typing one: the note is a note that starts with a rule.
    expect(frontmatterRange('---\nid: x\n\nstill writing')).toBeUndefined()
  })

  it('only counts at the very top of the note', () => {
    expect(frontmatterRange('# Title\n\n---\nid: x\n---')).toBeUndefined()
  })

  it('is not fooled by a horizontal rule', () => {
    expect(frontmatterRange('----\nnot yaml\n----')).toBeUndefined()
  })
})

describe('parseFrontmatter', () => {
  it('reads scalars, keeping quotes out of the value', () => {
    expect(parseFrontmatter('---\nid: obj-acero\ntitle: "Acero del manantial"\n---\n')).toEqual([
      { key: 'id', value: 'obj-acero' },
      { key: 'title', value: 'Acero del manantial' },
    ])
  })

  it('reads a list', () => {
    const props = parseFrontmatter('---\ntags:\n  - objeto\n  - sequia\n---\n')
    expect(props).toEqual([{ key: 'tags', value: ['objeto', 'sequia'] }])
  })

  it('reads an inline list', () => {
    expect(parseFrontmatter('---\ntags: [objeto, "sequia, y sed"]\n---\n')).toEqual([
      { key: 'tags', value: ['objeto', 'sequia, y sed'] },
    ])
  })

  it('folds the block scalars Obsidian wraps long values in', () => {
    // The shape the vault is actually full of: a list whose items are folded
    // block scalars, each running over several lines.
    const props = parseFrontmatter(
      [
        '---',
        'effects:',
        '  - >-',
        '    El agua del manantial no cierra lo que abrió su propio acero: ni la poza,',
        '    ni la Lágrima de Milia',
        '  - >-',
        '    Todo lo demás cura con normalidad',
        "  - 'La daga del tratado: 1d4 perforante'",
        '---',
        '',
        '# Acero',
      ].join('\n'),
    )
    expect(props).toEqual([
      {
        key: 'effects',
        value: [
          'El agua del manantial no cierra lo que abrió su propio acero: ni la poza, ni la Lágrima de Milia',
          'Todo lo demás cura con normalidad',
          'La daga del tratado: 1d4 perforante',
        ],
      },
    ])
  })

  it('keeps a literal block scalar on its own lines', () => {
    expect(parseFrontmatter('---\nnote: |\n  first\n  second\n---\n')).toEqual([
      { key: 'note', value: 'first\nsecond' },
    ])
  })

  it('shows a value it does not understand as written', () => {
    expect(parseFrontmatter('---\nnested:\n  a: 1\n  b: 2\n---\n')).toEqual([
      { key: 'nested', value: 'a: 1\nb: 2' },
    ])
  })

  it('is empty for a note without frontmatter', () => {
    expect(parseFrontmatter('# Just a note\n')).toEqual([])
  })
})

describe('frontmatterTags', () => {
  it('takes tags from a list, an inline list or a plain string', () => {
    const from = (yaml: string) => frontmatterTags(parseFrontmatter(`---\n${yaml}\n---\n`))
    expect(from('tags:\n  - pnj\n  - "#roquena"')).toEqual(['pnj', 'roquena'])
    expect(from('tags: [pnj, roquena]')).toEqual(['pnj', 'roquena'])
    expect(from('tags: pnj, roquena')).toEqual(['pnj', 'roquena'])
    expect(from('tag: pnj')).toEqual(['pnj'])
  })

  it('ignores every other property', () => {
    expect(frontmatterTags(parseFrontmatter('---\nid: x\ntitulo: pnj\n---\n'))).toEqual([])
  })
})
