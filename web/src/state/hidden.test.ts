import { describe, expect, it } from 'vitest'
import { shownInTree, type TreeFilter } from './hidden'

describe('hiding from the tree', () => {
  it('shows everything with no rules', () => {
    expect(shownInTree([], 'journal/2026-10-12.md')).toBe(true)
  })

  it('hides what a rule says yes to', () => {
    const rule: TreeFilter = (path) => path.startsWith('journal/')
    expect(shownInTree([rule], 'journal/2026-10-12.md')).toBe(false)
    expect(shownInTree([rule], 'notes/a.md')).toBe(true)
  })

  it('treats a rule that throws as hiding nothing', () => {
    const broken: TreeFilter = () => {
      throw new Error('boom')
    }
    expect(shownInTree([broken], 'notes/a.md')).toBe(true)
  })
})
