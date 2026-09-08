import { useState, type ReactNode } from 'react'

/**
 * A collapsible block in the sidebar, shaped like the backlinks strip.
 *
 * Closed to begin with, and remembered. A section that scans the vault should
 * only do it while it is open — on a phone, and against a vault the size of a
 * real one, an always-on panel is felt.
 *
 * Part of the contract rather than a file that happens to sit nearby:
 * `sidebarSection` promises a block that is collapsed until it is opened, and
 * this is what keeps that promise. It carries no styles of its own — the class
 * names below are the host's to theme, and a package shipping its own CSS
 * would only fight the app it is running in.
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
  const [open, setOpen] = useState(() => remembered(key))

  function toggle() {
    const next = !open
    setOpen(next)
    try {
      localStorage.setItem(key, next ? 'open' : 'closed')
    } catch {
      /* Storage off in a private window. The section still opens. */
    }
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

function remembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'open'
  } catch {
    return false
  }
}

/**
 * The two glyphs the header needs, inline.
 *
 * Copied from the app's icon set rather than imported from it, for the reason
 * the whole package exists: a 16px stroke on `currentColor` takes the theme
 * for free, and it is not worth a dependency on `ui/icons` to say so.
 */
function Caret({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  )
}

const ChevronRight = () => <Caret d="M6 3.5 10.5 8 6 12.5" />
const ChevronDown = () => <Caret d="M3.5 6 8 10.5 12.5 6" />
