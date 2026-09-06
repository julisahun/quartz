import { useCallback, useLayoutEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { persisted } from '../state/persist'

/**
 * The drag handle on the note list's right edge.
 *
 * The width lives in a CSS variable rather than in the grid, so a drag can
 * write it straight to the document: a pointer moving at 60fps should not
 * re-render the note list on every frame. React only hears about it when the
 * finger comes off, which is also when it is worth writing down.
 */

/** 17rem — the width the list has until someone drags it. */
const DEFAULT_PX = 272
/** The bounds `.app`'s `clamp()` enforces anyway; here so aria cannot lie. */
const MIN_PX = 192
const MAX_PX = 480
/** How much an arrow key moves it, and how much with shift held. */
const STEP_PX = 16
const BIG_STEP_PX = 64

function clampWidth(px: number): number {
  // Never more than half the window: a list wider than the note it opens is
  // not a list any more.
  return Math.round(Math.max(MIN_PX, Math.min(px, MAX_PX, window.innerWidth / 2)))
}

function setWidthVar(px: number): void {
  document.documentElement.style.setProperty('--sidebar-width', `${px}px`)
}

export function SidebarResizer() {
  const [width, setWidth] = useState(() => clampWidth(persisted.sidebarWidth() ?? DEFAULT_PX))

  // Before the paint, so the list is not briefly the default width on load.
  useLayoutEffect(() => setWidthVar(width), [width])

  const commit = useCallback((px: number) => {
    const next = clampWidth(px)
    setWidth(next)
    persisted.setSidebarWidth(next)
  }, [])

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const handle = event.currentTarget
    const sidebar = handle.parentElement
    if (!sidebar) return

    // The edge follows the pointer exactly, rather than the few pixels off
    // that grabbing the side of the handle would leave it.
    const left = sidebar.getBoundingClientRect().left
    // Stops the drag from selecting the note titles it passes over.
    event.preventDefault()
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
    document.documentElement.classList.add('resizing')

    let latest = width
    const move = (moved: globalThis.PointerEvent) => {
      latest = clampWidth(moved.clientX - left)
      setWidthVar(latest)
    }
    const done = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', done)
      handle.removeEventListener('pointercancel', done)
      handle.classList.remove('dragging')
      document.documentElement.classList.remove('resizing')
      commit(latest)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', done)
    handle.addEventListener('pointercancel', done)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? BIG_STEP_PX : STEP_PX
    if (event.key === 'ArrowLeft') commit(width - step)
    else if (event.key === 'ArrowRight') commit(width + step)
    else if (event.key === 'Home') commit(MIN_PX)
    else if (event.key === 'End') commit(MAX_PX)
    else return
    event.preventDefault()
  }

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the note list"
      aria-valuenow={width}
      aria-valuemin={MIN_PX}
      aria-valuemax={MAX_PX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => commit(DEFAULT_PX)}
      title="Drag to resize — double-click to reset"
    />
  )
}
