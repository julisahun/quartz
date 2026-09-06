import { useSyncExternalStore } from 'react'
import { readViewport } from '../editor/mobile'

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
 * Whether the on-screen keyboard is up. There is no API that answers this, so
 * it is read off the same visual viewport the layout follows — one reading, so
 * the toolbar cannot disagree with the layout it sits in.
 */
function keyboardIsOpen(): boolean {
  return readViewport().keyboard
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
