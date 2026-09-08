import { useEffect, useMemo, useRef, useState } from 'react'
import { findCommands, useCommands, type Command } from '../state/commands'
import { rankNotes, type QuickHit } from '../state/quick-open'
import { useApp } from '../state/store'

/**
 * ⌘P / Ctrl-P: the note switcher, and behind `>` the command list.
 *
 * Deliberately not the sidebar's search box. That one asks the server what is
 * *inside* the notes and waits for an answer; this one matches names and paths
 * on the device and never waits at all, which is what you want when you know
 * where you are going and are already typing.
 *
 * `>` is the same switch every editor with one of these uses, and it costs
 * nothing: no note is called `>anything`.
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
  const commands = useCommands()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const asCommand = query.startsWith('>')

  const hits = useMemo(
    () => (open && !asCommand ? rankNotes(query, files) : []),
    [open, asCommand, query, files],
  )
  const runnable = useMemo(
    () => (open && asCommand ? findCommands(commands, query.slice(1)) : []),
    [open, asCommand, query, commands],
  )
  const count = asCommand ? runnable.length : hits.length

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
  }, [active, hits, runnable])

  if (!open) return null

  function choose(hit: QuickHit | undefined) {
    if (hit) {
      void openNote(hit.path)
      onOpened()
    }
    onClose()
  }

  function runCommand(command: Command | undefined) {
    // Closed first: a command that opens a sheet of its own must not have this
    // one still over it, and one that throws must not leave the layer stuck.
    onClose()
    if (command) void Promise.resolve(command.run()).catch((err) => console.error(command.id, err))
  }

  function commit() {
    if (asCommand) runCommand(runnable[active])
    else choose(hits[active])
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, count - 1))
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let rows
  if (asCommand) {
    rows =
      runnable.length === 0 ? (
        <p className="empty">No command matches.</p>
      ) : (
        runnable.map((command, i) => (
          <button
            key={command.id}
            className={`quick-hit ${i === active ? 'active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => runCommand(command)}
          >
            <span className="quick-title">{command.title}</span>
          </button>
        ))
      )
  } else {
    rows =
      hits.length === 0 ? (
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
      )
  }

  return (
    <div className="quick-layer">
      <div className="quick-scrim" onClick={onClose} />
      <div className="quick" role="dialog" aria-modal="true" aria-label="Open a note">
        <input
          ref={field}
          className="quick-field"
          value={query}
          placeholder="Go to note, or > for commands…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="quick-list" ref={list}>
          {rows}
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
