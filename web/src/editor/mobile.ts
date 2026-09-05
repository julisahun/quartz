import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

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

    const keyboardTop = viewport.offsetTop + viewport.height
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
  }
  apply()
  viewport.addEventListener('resize', apply)
  viewport.addEventListener('scroll', apply)
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
  }
}
