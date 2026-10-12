import type { ReactNode } from 'react'
import { create } from 'zustand'
import { useApp } from '../state/store'
import { AppBar } from './AppBar'
import { ChevronLeft } from './icons'
import { useIsPhone } from './media'

/**
 * Screens that take the main pane instead of a note.
 *
 * Registered from outside, like slots: the pane renders whichever one the
 * store says is open, and knows nothing about what it is. Opening a view does
 * not close the note under it — the note comes back when the view closes,
 * and opening any note closes the view.
 */
export interface ViewEntry {
  /** Stable and unique. Registering an id twice replaces the first. */
  id: string
  /** Its name, in the phone's bar and the window title. */
  title: string
  render: () => ReactNode
}

interface ViewState {
  views: ViewEntry[]
}

const useViewStore = create<ViewState>()(() => ({ views: [] }))

/** Adds a view, and hands back the function that takes it away again. */
export function addView(entry: ViewEntry): () => void {
  useViewStore.setState((s) => ({ views: [...s.views.filter((v) => v.id !== entry.id), entry] }))
  return () => {
    useViewStore.setState((s) => ({ views: s.views.filter((v) => v !== entry) }))
    // A view withdrawn while open leaves the pane to the note under it.
    if (useApp.getState().currentView === entry.id) useApp.getState().closeView()
  }
}

/** React: the view with this id, if one is registered. */
export function useView(id: string | undefined): ViewEntry | undefined {
  return useViewStore((s) => (id ? s.views.find((v) => v.id === id) : undefined))
}

/** The open view in the pane, with a way back on a phone. */
export function ViewPane({ id, onBack }: { id: string; onBack: () => void }) {
  const view = useView(id)
  const isPhone = useIsPhone()

  return (
    <>
      {isPhone && (
        <AppBar
          leading={
            <button className="icon-button" onClick={onBack} aria-label="Back">
              <ChevronLeft />
            </button>
          }
          title={view?.title ?? ''}
        />
      )}
      <div className="view-scroll">
        {view ? view.render() : <p className="empty">This view is not available any more.</p>}
      </div>
    </>
  )
}
