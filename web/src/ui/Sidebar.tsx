import { useEffect, useMemo, useState } from 'react'
import type { SearchHit } from '../api/client'
import { useApp } from '../state/store'
import { folderOf, isConflictCopy, isNote, noteTitle } from '../state/notes'
import { VaultSwitcher } from './VaultSwitcher'

interface Props {
  onNavigate: () => void
}

export function Sidebar({ onNavigate }: Props) {
  const files = useApp((s) => s.files)
  const currentPath = useApp((s) => s.currentPath)
  const open = useApp((s) => s.open)
  const createNote = useApp((s) => s.createNote)
  const search = useApp((s) => s.search)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | undefined>()

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(undefined)
      return
    }
    // Search as you type, but only after a pause: the server is a Pi.
    const timer = setTimeout(() => void search(q).then(setHits), 180)
    return () => clearTimeout(timer)
  }, [query, search])

  const grouped = useMemo(() => {
    const notes = files.filter((f) => isNote(f.path))
    const byFolder = new Map<string, typeof notes>()
    for (const note of notes) {
      const folder = folderOf(note.path)
      const list = byFolder.get(folder) ?? []
      list.push(note)
      byFolder.set(folder, list)
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [files])

  async function newNote() {
    const title = prompt('Note title')
    if (title === null) return
    await createNote(title)
    onNavigate()
  }

  function choose(path: string) {
    void open(path)
    onNavigate()
  }

  return (
    <aside className="sidebar">
      <VaultSwitcher />
      <div className="sidebar-head">
        <input
          className="search"
          value={query}
          placeholder="Search notes"
          onChange={(e) => setQuery(e.target.value)}
          type="search"
        />
        <button className="ghost" onClick={newNote} title="New note">
          +
        </button>
      </div>

      <div className="note-list">
        {hits ? (
          hits.length === 0 ? (
            <p className="empty">Nothing matches.</p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.path}
                className={`note-row ${hit.path === currentPath ? 'active' : ''}`}
                onClick={() => choose(hit.path)}
              >
                <span className="note-title">{hit.title || noteTitle(hit.path)}</span>
                <span
                  className="note-snippet"
                  // The snippet comes from the server's own FTS output, which
                  // marks matches with <mark> and escapes nothing else.
                  dangerouslySetInnerHTML={{ __html: sanitiseSnippet(hit.snippet) }}
                />
              </button>
            ))
          )
        ) : (
          grouped.map(([folder, notes]) => (
            <section key={folder}>
              {folder && <h3 className="folder">{folder}</h3>}
              {notes.map((note) => (
                <button
                  key={note.path}
                  className={`note-row ${note.path === currentPath ? 'active' : ''}`}
                  onClick={() => choose(note.path)}
                >
                  <span className="note-title">
                    {noteTitle(note.path)}
                    {isConflictCopy(note.path) && <span className="tag">conflict</span>}
                  </span>
                </button>
              ))}
            </section>
          ))
        )}
        {files.length === 0 && !hits && <p className="empty">No notes yet.</p>}
      </div>
    </aside>
  )
}

/** Keeps <mark> from the search snippet and escapes everything else. */
function sanitiseSnippet(snippet: string): string {
  return snippet
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>')
}
