import { describe, expect, it } from 'vitest'
import { buildTree, foldersTo, type TreeFolder, type TreeNode } from './tree'
import type { FileMeta } from '../vault/types'

const vault = (...paths: string[]): FileMeta[] =>
  paths.map((path) => ({ path, hash: 'h', size: 0, mtime: 0 }))

/** The shape of a tree, as an indented outline — easier to read than nesting. */
function outline(nodes: TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) =>
    node.kind === 'folder'
      ? [`${'  '.repeat(depth)}${node.name}/ (${node.count})`, ...outline(node.children, depth + 1)]
      : [`${'  '.repeat(depth)}${node.title}`],
  )
}

describe('buildTree', () => {
  it('turns paths back into the folders they came from', () => {
    const tree = buildTree(vault('dnd/pnj/Ossian.md', 'dnd/objects/Acero.md', 'Inbox.md'))
    expect(outline(tree)).toEqual([
      'dnd/ (2)',
      '  objects/ (1)',
      '    Acero',
      '  pnj/ (1)',
      '    Ossian',
      'Inbox',
    ])
  })

  it('puts folders before notes, and sorts numbers as numbers', () => {
    const tree = buildTree(vault('a/9-nine.md', 'a/10-ten.md', 'zzz.md', 'a/b/deep.md'))
    expect(outline(tree)).toEqual(['a/ (3)', '  b/ (1)', '    deep', '  9-nine', '  10-ten', 'zzz'])
  })

  it('counts every note underneath, however deep', () => {
    const tree = buildTree(vault('a/b/c/1.md', 'a/b/2.md', 'a/3.md'))
    const a = tree[0] as TreeFolder
    expect(a.count).toBe(3)
    expect((a.children[0] as TreeFolder).count).toBe(2)
  })

  it('lists PDFs beside the notes, and leaves other attachments out', () => {
    // The handouts live in the vault's own folders, not in attachments/, and
    // are half the reason those folders exist.
    const tree = buildTree(vault('mundo/talasia.md', 'mundo/carta.pdf', 'attachments/logo.png'))
    expect(outline(tree)).toEqual(['mundo/ (2)', '  carta.pdf', '  talasia'])

    const mundo = tree[0] as TreeFolder
    expect(mundo.children.map((c) => c.kind === 'file' && c.pdf)).toEqual([true, false])
  })
})

describe('foldersTo', () => {
  it('lists every folder on the way to a note', () => {
    expect(foldersTo('dnd/talasia/pnj/Ossian.md')).toEqual(['dnd', 'dnd/talasia', 'dnd/talasia/pnj'])
    expect(foldersTo('Inbox.md')).toEqual([])
  })
})
