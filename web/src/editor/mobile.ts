import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** Height of whatever sits between the editor and the keyboard, e.g. the toolbar. */
let accessoryHeight = 0

/** The toolbar reports its own height, so the caret can clear it too. */
export function setAccessoryHeight(px: number): void {
  accessoryHeight = px
}

/**
 * Keeps the caret above the on-screen keyboard.
 *
 * iOS resizes the visual viewport rather than the layout viewport, so the
 * editor has no idea half of it is now behind the keyboard. Tracking
 * visualViewport and scrolling the cursor back into view is what stops typing
 * from disappearing under the keys.
 */
export function keyboardAware(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return
    const viewport = window.visualViewport
    if (!viewport) return

    const view = update.view
    const coords = view.coordsAtPos(view.state.selection.main.head)
    if (!coords) return

    const keyboardTop = viewport.offsetTop + viewport.height - accessoryHeight
    if (coords.bottom > keyboardTop - 8) {
      // requestAnimationFrame: let the keyboard finish animating first.
      requestAnimationFrame(() => {
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) })
      })
    }
  })
}

/**
 * Publishes the visual viewport height as a CSS variable so the layout can sit
 * above the keyboard instead of behind it.
 */
export function trackViewportHeight(): () => void {
  const viewport = window.visualViewport
  if (!viewport) return () => {}

  const apply = () => {
    document.documentElement.style.setProperty('--viewport-height', `${viewport.height}px`)
    // A hook for the layout: the status bar steps aside for the keyboard.
    const open = window.innerHeight - viewport.height > 120
    document.documentElement.dataset.keyboard = open ? 'open' : 'closed'
  }
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    delete document.documentElement.dataset.keyboard
  }
}
