import { create } from 'zustand'

/**
 * Paths the note tree leaves out.
 *
 * Only the tree: search, ⌘P, links and backlinks still see everything, so a
 * hidden note is tidied away rather than lost. Registered from outside, and
 * each rule is withdrawn by the function that added it — whatever hid a
 * folder is what brings it back.
 */
export type TreeFilter = (path: string) => boolean

interface HiddenState {
  filters: TreeFilter[]
}

const useHiddenStore = create<HiddenState>()(() => ({ filters: [] }))

/** Hides every path `hide` says yes to, until the returned function is called. */
export function hideFromTree(hide: TreeFilter): () => void {
  useHiddenStore.setState((s) => ({ filters: [...s.filters, hide] }))
  return () => useHiddenStore.setState((s) => ({ filters: s.filters.filter((f) => f !== hide) }))
}

/** React: the rules in force. A stable reference until one changes. */
export function useTreeFilters(): TreeFilter[] {
  return useHiddenStore((s) => s.filters)
}

/**
 * Whether the tree shows a path. A rule that throws hides nothing: it is
 * somebody else's code, and the notes are the one thing that must stay
 * reachable.
 */
export function shownInTree(filters: TreeFilter[], path: string): boolean {
  return !filters.some((hide) => {
    try {
      return hide(path)
    } catch {
      return false
    }
  })
}
