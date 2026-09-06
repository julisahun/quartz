import { useState } from 'react'
import { isNote } from '../state/notes'
import { useApp } from '../state/store'
import { ChevronDown, ChevronRight } from './icons'

/**
 * The notes pointing at this one, under the editor.
 *
 * A note nothing links to shows nothing at all: on a phone the strip would
 * cost a row of the editor to say "0", and in a small vault most notes have
 * no inbound links yet.
 */
export function Backlinks() {
  const backlinks = useApp((s) => s.backlinks)
  const currentPath = useApp((s) => s.currentPath)
  const open = useApp((s) => s.open)
  const [expanded, setExpanded] = useState(() => localStorage.getItem('backlinks') === 'open')

  if (!currentPath || !isNote(currentPath) || backlinks.length === 0) return null

  function toggle() {
    const next = !expanded
    setExpanded(next)
    localStorage.setItem('backlinks', next ? 'open' : 'closed')
  }

  return (
    <section className={`backlinks ${expanded ? 'expanded' : ''}`}>
      <button className="backlinks-head" onClick={toggle} aria-expanded={expanded}>
        <span className="backlinks-caret" aria-hidden="true">
          {expanded ? <ChevronDown /> : <ChevronRight />}
        </span>
        <span>
          {backlinks.length} linked mention{backlinks.length === 1 ? '' : 's'}
        </span>
      </button>

      {expanded && (
        <ul className="backlink-list">
          {backlinks.map((link) => (
            <li key={`${link.path}:${link.line}`}>
              <button className="backlink" onClick={() => void open(link.path)}>
                <span className="backlink-title">{link.title}</span>
                {/* The source line as written — this is a markdown app, and
                    the brackets are how you find the link once you are there. */}
                <span className="backlink-context">{link.context}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
