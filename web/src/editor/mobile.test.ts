// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { trackViewport } from './mobile'

interface FakeViewport {
  height: number
  offsetTop: number
  scale: number
  emit(): void
}

/** jsdom has no visual viewport, so this is the one the browser would give. */
function fakeViewport(): FakeViewport {
  const listeners = new Set<() => void>()
  const viewport = {
    height: window.innerHeight,
    offsetTop: 0,
    scale: 1,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    emit: () => listeners.forEach((fn) => fn()),
  }
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  return viewport as unknown as FakeViewport
}

const root = document.documentElement
const cssVar = (name: string) => root.style.getPropertyValue(name)

afterEach(() => {
  root.removeAttribute('style')
  delete root.dataset.keyboard
})

describe('trackViewport', () => {
  it('follows the keyboard, the pan it comes with included', () => {
    const viewport = fakeViewport()
    const stop = trackViewport()

    expect(cssVar('--viewport-height')).toBe('768px')
    expect(cssVar('--viewport-top')).toBe('0px')
    expect(root.dataset.keyboard).toBe('closed')

    // The keyboard takes 300px, and iOS pans what is left down by 60 to bring
    // the focused field into view. Missing that pan is what leaves the layout
    // 60px above the screen.
    viewport.height = 468
    viewport.offsetTop = 60
    viewport.emit()

    expect(cssVar('--viewport-height')).toBe('468px')
    expect(cssVar('--viewport-top')).toBe('60px')
    expect(root.dataset.keyboard).toBe('open')

    stop()
    expect(cssVar('--viewport-height')).toBe('')
    expect(root.dataset.keyboard).toBeUndefined()
  })

  it('leaves a pinch-zoomed page where it is', () => {
    const viewport = fakeViewport()
    const stop = trackViewport()

    // Zoomed in, the visual viewport is the magnifying glass rather than the
    // screen. Following it would take panning away from whoever zoomed.
    viewport.scale = 2
    viewport.height = 384
    viewport.offsetTop = 200
    viewport.emit()

    expect(cssVar('--viewport-height')).toBe('768px')
    expect(cssVar('--viewport-top')).toBe('0px')
    expect(root.dataset.keyboard).toBe('closed')
    stop()
  })
})
