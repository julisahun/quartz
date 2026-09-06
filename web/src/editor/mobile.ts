import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** Height of whatever sits between the editor and the keyboard, e.g. the toolbar. */
let accessoryHeight = 0

/** How much of the layout viewport has to be missing before it reads as a keyboard. */
const KEYBOARD_GAP_PX = 120

/** The toolbar reports its own height, so the caret can clear it too. */
export function setAccessoryHeight(px: number): void {
  accessoryHeight = px
}

/** What is actually on screen, and how far down the page it starts. */
export interface Viewport {
  /** Height of the visible area — the layout viewport minus the keyboard. */
  height: number
  /** How far the visible area has been panned down inside the layout viewport. */
  top: number
  /** Whether the missing height reads as an on-screen keyboard. */
  keyboard: boolean
}

/**
 * Reads the visual viewport.
 *
 * iOS does two things when a field is focused: it shrinks the visual viewport
 * by the height of the keyboard, and — because there is nothing to scroll — it
 * pans that viewport down inside the layout viewport to bring the field into
 * view. The pan is `offsetTop`, and anything anchored to the layout viewport
 * ends up exactly that far above the screen.
 *
 * Pinch-zoom moves the same viewport, and is deliberately excluded: zoomed in,
 * the visual viewport is a magnifying glass over the page rather than the
 * screen itself, and following it would take panning away from whoever needed
 * the magnification.
 */
export function readViewport(): Viewport {
  const viewport = window.visualViewport
  if (!viewport || viewport.scale > 1.01) {
    return { height: window.innerHeight, top: 0, keyboard: false }
  }
  return {
    height: viewport.height,
    top: viewport.offsetTop,
    keyboard: window.innerHeight - viewport.height > KEYBOARD_GAP_PX,
  }
}

/**
 * Keeps the caret above the on-screen keyboard.
 *
 * The layout already sits above the keyboard, but a long note scrolls
 * underneath it, so the caret can still end up behind the keys. Scrolling it
 * back into view is what stops typing from disappearing.
 */
export function keyboardAware(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return
    // No visual viewport means no on-screen keyboard to be above.
    if (!window.visualViewport) return

    const view = update.view
    const coords = view.coordsAtPos(view.state.selection.main.head)
    if (!coords) return

    const { height, top } = readViewport()
    const keyboardTop = top + height - accessoryHeight
    if (coords.bottom > keyboardTop - 8) {
      // requestAnimationFrame: let the keyboard finish animating first.
      requestAnimationFrame(() => {
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) })
      })
    }
  })
}

/**
 * Publishes the visible area as CSS variables, so everything pinned to the
 * screen can be pinned to the part of it you can actually see.
 */
export function trackViewport(): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  const root = document.documentElement
  const apply = () => {
    const { height, top, keyboard } = readViewport()
    root.style.setProperty('--viewport-height', `${Math.round(height)}px`)
    root.style.setProperty('--viewport-top', `${Math.round(top)}px`)
    // A hook for the layout: the status bar steps aside for the keyboard, and
    // the home indicator's inset stops being worth reserving.
    root.dataset.keyboard = keyboard ? 'open' : 'closed'
  }
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    root.style.removeProperty('--viewport-height')
    root.style.removeProperty('--viewport-top')
    delete root.dataset.keyboard
  }
}
