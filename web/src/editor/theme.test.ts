import { describe, expect, it } from 'vitest'
import { themeSpec } from './theme'

/**
 * CodeMirror builds its height map from `getBoundingClientRect()`, which does
 * not include margins. A vertical margin anywhere in this theme therefore adds
 * space the editor cannot see, its idea of where each line sits drifts down the
 * document, and clicking a line puts the cursor on the one below it — which is
 * exactly the bug this replaced. Space is padding here, and stays padding.
 */
describe('editor theme', () => {
  it('has no vertical margins', () => {
    const offenders: string[] = []
    for (const [selector, rules] of Object.entries(themeSpec)) {
      for (const [property, value] of Object.entries(rules as Record<string, string>)) {
        if (verticalMargin(property, value)) offenders.push(`${selector} { ${property}: ${value} }`)
      }
    }
    expect(offenders).toEqual([])
  })
})

function verticalMargin(property: string, value: string): boolean {
  if (property === 'marginTop' || property === 'marginBottom') return !isZero(value)
  if (property !== 'margin') return false
  const parts = value.trim().split(/\s+/)
  return !isZero(parts[0]) || !isZero(parts.length >= 3 ? parts[2] : parts[0])
}

function isZero(value: string): boolean {
  return /^0([a-z%]*)$/.test(value)
}
