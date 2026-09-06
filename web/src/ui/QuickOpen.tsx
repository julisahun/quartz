import { useEffect, useMemo, useRef, useState } from 'react'
import { rankNotes, type QuickHit } from '../state/quick-open'
import { useApp } from '../state/store'

/**
 * ⌘P / Ctrl-P: the note switcher.
 *
 * Deliberately not the sidebar's search box. That one asks the server what is
 * *inside* the notes and waits for an answer; this one matches names and paths
 * on the device and never waits at all, which is what you want when you know
 * where you are going and are already typing.
 */
interface Props {
  open: boolean
  onClose: () => void
  /** Only when a note was actually picked: on a phone that is a screen change. */
  onOpened: () => void
}

export function QuickOpen({ open, onClose, onOpened }: Props) {
  const files = useApp((s) => s.files)
  const openNote = useApp((s) => s.open)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => (open ? rankNotes(query, files) : []), [open, query, files])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    field.current?.focus()
  }, [open])

  useEffect(() => setActive(0), [query])

  // Keep the highlighted row on screen while the arrows walk past the fold.
  useEffect(() => {
    list.current?.querySelector('.quick-hit.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, hits])

  if (!open) return null

  function choose(hit: QuickHit | undefined) {
    if (hit) {
      void openNote(hit.path)
      onOpened()
    }
    onClose()
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(hits[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="quick-layer">
      <div className="quick-scrim" onClick={onClose} />
      <div className="quick" role="dialog" aria-modal="true" aria-label="Open a note">
        <input
          ref={field}
          className="quick-field"
          value={query}
          placeholder="Go to note…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="quick-list" ref={list}>
          {hits.length === 0 ? (
            <p className="empty">No note matches.</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.path}
                className={`quick-hit ${i === active ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit)}
              >
                <span className="quick-title">{highlight(hit)}</span>
                {hit.folder && <span className="quick-folder">{hit.folder}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The title with the matched letters picked out. The offsets are into the
 * whole path, so the ones falling inside the folder half simply miss.
 */
function highlight(hit: QuickHit) {
  const titleStart = hit.folder ? hit.folder.length + 1 : 0
  const matched = new Set(hit.matches.map((i) => i - titleStart))
  return [...hit.title].map((char, i) =>
    matched.has(i) ? (
      <mark key={i}>{char}</mark>
    ) : (
      <span key={i}>{char}</span>
    ),
  )
}
