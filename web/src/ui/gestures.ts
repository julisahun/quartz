import { useEffect } from 'react'

/**
 * Touch gestures, written against the DOM rather than React state: a finger
 * moving at 60fps should not re-render a note list on every frame.
 */

/** How far in from the left edge a back swipe has to start. */
const BACK_EDGE_PX = 30
/** Below this a touch is still ambiguous, and might yet be a scroll. */
const SLOP_PX = 10

interface SwipeBackOptions {
  enabled: boolean
  onBack: () => void
}

/**
 * Drag in from the left edge to go back, the way iOS does it. Gated to the
 * edge on purpose: anywhere else, a horizontal drag belongs to the text
 * selection the editor is trying to make.
 */
export function useSwipeBack(el: HTMLElement | null, { enabled, onBack }: SwipeBackOptions) {
  useEffect(() => {
    if (!el || !enabled) return

    let startX = 0
    let startY = 0
    let dx = 0
    let candidate = false
    let dragging = false

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      candidate = touch.clientX <= BACK_EDGE_PX
      dragging = false
      dx = 0
      startX = touch.clientX
      startY = touch.clientY
    }

    const move = (event: TouchEvent) => {
      if (!candidate) return
      const touch = event.touches[0]
      dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!dragging) {
        if (Math.abs(dy) > Math.abs(dx)) {
          candidate = false
          return
        }
        if (dx < SLOP_PX) return
        dragging = true
        el.style.transition = 'none'
      }
      event.preventDefault()
      el.style.transform = `translateX(${Math.max(0, dx)}px)`
    }

    const end = () => {
      if (!dragging) {
        candidate = false
        return
      }
      // Past a third of the way across, the gesture reads as a decision.
      const committed = dx > Math.min(150, el.clientWidth * 0.32)
      el.style.transition = ''
      el.style.transform = ''
      candidate = false
      dragging = false
      if (committed) onBack()
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      el.style.transition = ''
      el.style.transform = ''
    }
  }, [el, enabled, onBack])
}

const PULL_TRIGGER_PX = 64
const PULL_MAX_PX = 96

interface PullOptions {
  enabled: boolean
  onRefresh: () => Promise<void>
}

/**
 * Pull the note list down to sync. The sync dot is a 2mm target; a pull is the
 * whole screen, and it is the gesture every phone user already tries.
 */
export function usePullToRefresh(
  el: HTMLElement | null,
  frame: HTMLElement | null,
  { enabled, onRefresh }: PullOptions,
) {
  useEffect(() => {
    if (!el || !frame || !enabled) return

    let startY = 0
    let pull = 0
    let candidate = false
    let dragging = false
    let running = false
    let live = true

    const setPull = (px: number) => {
      frame.style.setProperty('--pull', `${px}px`)
      frame.style.setProperty('--pull-ratio', `${Math.min(1, px / PULL_TRIGGER_PX)}`)
    }

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || running) return
      candidate = el.scrollTop <= 0
      dragging = false
      pull = 0
      startY = event.touches[0].clientY
    }

    const move = (event: TouchEvent) => {
      if (!candidate) return
      const dy = event.touches[0].clientY - startY
      if (dy <= 0 || el.scrollTop > 0) {
        if (dragging) setPull(0)
        candidate = false
        dragging = false
        return
      }
      if (!dragging) {
        if (dy < SLOP_PX) return
        dragging = true
        frame.classList.add('pulling')
      }
      event.preventDefault()
      // Damped, so the list follows the finger without matching it: the drag
      // reads as elastic rather than as scrolling something.
      pull = Math.min(PULL_MAX_PX, dy * 0.5)
      setPull(pull)
    }

    const end = () => {
      candidate = false
      if (!dragging) return
      dragging = false
      frame.classList.remove('pulling')
      if (pull < PULL_TRIGGER_PX) {
        setPull(0)
        return
      }
      running = true
      frame.classList.add('refreshing')
      setPull(PULL_TRIGGER_PX)
      void onRefresh().finally(() => {
        running = false
        if (!live) return
        frame.classList.remove('refreshing')
        setPull(0)
      })
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      live = false
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
      frame.classList.remove('pulling', 'refreshing')
      setPull(0)
    }
  }, [el, frame, enabled, onRefresh])
}

interface RevealOptions {
  enabled: boolean
  /** How wide the action is, and so how far the swipe travels. */
  width: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Swipe a row left to uncover the action at its end. The swipe only reveals —
 * the button still has to be pressed — because on this vault a delete is only
 * recoverable over SSH.
 *
 * The action slides in over the row rather than the row sliding out from under
 * it: note titles are short, and a row that shifts a button's width to the left
 * has nothing left to read.
 */
export function useSwipeToReveal(
  zone: HTMLElement | null,
  action: HTMLElement | null,
  { enabled, width, open, onOpenChange }: RevealOptions,
) {
  useEffect(() => {
    const el = zone
    if (!el || !action || !enabled) return

    let startX = 0
    let startY = 0
    let offset = 0
    let candidate = false
    let dragging = false

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      candidate = true
      dragging = false
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
      offset = open ? -width : 0
    }

    const move = (event: TouchEvent) => {
      if (!candidate) return
      const dx = event.touches[0].clientX - startX
      const dy = event.touches[0].clientY - startY
      if (!dragging) {
        if (Math.abs(dx) < SLOP_PX) return
        if (Math.abs(dy) >= Math.abs(dx)) {
          candidate = false
          return
        }
        dragging = true
        action.style.transition = 'none'
      }
      event.preventDefault()
      const base = open ? -width : 0
      offset = Math.max(-width, Math.min(0, base + dx))
      action.style.transform = `translateX(${width + offset}px)`
    }

    const end = () => {
      candidate = false
      if (!dragging) return
      dragging = false
      action.style.transition = ''
      const next = offset < -width / 2
      action.style.transform = next ? 'translateX(0px)' : ''
      if (next !== open) onOpenChange(next)
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [zone, action, enabled, width, open, onOpenChange])

  // The row can also be closed from outside — by opening another one, or by
  // the action finishing — so the resting position follows the prop.
  useEffect(() => {
    if (!action) return
    action.style.transform = enabled && open ? 'translateX(0px)' : ''
  }, [action, enabled, open])
}
