import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from '../ui/icons'

/**
 * A collapsible block in the sidebar, shaped like the backlinks strip.
 *
 * Closed to begin with, and remembered. A section that scans the vault should
 * only do it while it is open — on a phone, and against a vault the size of a
 * real one, an always-on panel is felt.
 */
export function Section({
  id,
  title,
  summary,
  children,
}: {
  /** Namespaces what is remembered about this section. */
  id: string
  title: string
  /** A word or two shown on the closed header — a count, usually. */
  summary?: ReactNode
  children: (open: boolean) => ReactNode
}) {
  const key = `section:${id}`
  const [open, setOpen] = useState(() => localStorage.getItem(key) === 'open')

  function toggle() {
    const next = !open
    setOpen(next)
    localStorage.setItem(key, next ? 'open' : 'closed')
  }

  return (
    <section className={`px-section ${open ? 'expanded' : ''}`}>
      <button className="px-section-head" onClick={toggle} aria-expanded={open}>
        <span className="px-section-caret" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span className="px-section-title">{title}</span>
        {summary !== undefined && <span className="px-section-summary">{summary}</span>}
      </button>
      {children(open)}
    </section>
  )
}
