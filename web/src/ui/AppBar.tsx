import type { ReactNode } from 'react'

/**
 * The bar at the top of a phone screen: something to go back with, what you
 * are looking at, and the actions that belong to it. Above 46rem the layout
 * shows both panes at once and these do not render.
 */
export function AppBar({
  leading,
  title,
  trailing,
}: {
  leading?: ReactNode
  title: ReactNode
  trailing?: ReactNode
}) {
  return (
    <header className="appbar">
      <div className="appbar-slot">{leading}</div>
      <div className="appbar-title">{title}</div>
      <div className="appbar-slot end">{trailing}</div>
    </header>
  )
}
