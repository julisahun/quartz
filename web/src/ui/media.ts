import { useSyncExternalStore } from 'react'

/** Below this the app is one screen at a time; above it, list and note sit side by side. */
export const PHONE_QUERY = '(max-width: 46rem)'

function subscribeToQuery(query: string) {
  return (onChange: () => void) => {
    if (typeof window.matchMedia !== 'function') return () => {}
    const list = window.matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }
}

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeToQuery(query),
    () => matches(query),
    () => false,
  )
}

export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY)
}

/**
 * Whether the on-screen keyboard is up, inferred from the gap the visual
 * viewport leaves behind. There is no API that answers this directly, and the
 * gap is what actually matters: it is the space the layout has lost.
 */
function keyboardIsOpen(): boolean {
  const viewport = window.visualViewport
  if (!viewport) return false
  return window.innerHeight - viewport.height > 120
}

export function useKeyboardOpen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const viewport = window.visualViewport
      if (!viewport) return () => {}
      viewport.addEventListener('resize', onChange)
      return () => viewport.removeEventListener('resize', onChange)
    },
    keyboardIsOpen,
    () => false,
  )
}

/** Honours the system's "reduce motion" setting for the screen transitions. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}
