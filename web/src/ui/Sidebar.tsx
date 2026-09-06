import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SearchHit } from '../api/client'
import { useApp } from '../state/store'
import { folderOf, isConflictCopy, isNote, noteTitle } from '../state/notes'
import { vaultHint } from '../state/vaults'
import { foldersSupported } from '../vault/folders'
import { promptDelete, promptForgetFolder, promptNewNote, promptSignOut } from './actions'
import { AppBar } from './AppBar'
import { openMenu } from './dialogs'
import { usePullToRefresh, useSwipeToReveal } from './gestures'
import { ChevronRight, Ellipsis, Plus, Refresh, Trash } from './icons'
import { useIsPhone } from './media'
import { VaultSwitcher } from './VaultSwitcher'

/** How much of the delete button a swipe uncovers. */
const REVEAL_PX = 92

interface Props {
  onNavigate: () => void
  /** True while the note screen is covering this one, so it stays out of reach. */
  inert?: boolean
}

export function Sidebar({ onNavigate, inert }: Props) {
  const files = useApp((s) => s.files)
  const vaults = useApp((s) => s.vaults)
  const currentVault = useApp((s) => s.currentVault)
  const currentPath = useApp((s) => s.currentPath)
  const open = useApp((s) => s.open)
  const search = useApp((s) => s.search)
  const syncNow = useApp((s) => s.syncNow)
  const selectVault = useApp((s) => s.selectVault)
  const openFolder = useApp((s) => s.openFolder)
  const user = useApp((s) => s.user)
  const isPhone = useIsPhone()

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | undefined>()
  const [swiped, setSwiped] = useState<string | undefined>()
  const [listFrame, setListFrame] = useState<HTMLDivElement | null>(null)
  const [listScroller, setListScroller] = useState<HTMLDivElement | null>(null)

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

  const refresh = useCallback(() => syncNow(), [syncNow])
  usePullToRefresh(listScroller, listFrame, { enabled: isPhone, onRefresh: refresh })

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
    const path = await promptNewNote()
    if (path) onNavigate()
  }

  function choose(path: string) {
    void open(path)
    onNavigate()
  }

  function vaultMenu() {
    void openMenu(
      'Vaults',
      vaults.map((vault) => ({
        label: vault.name,
        hint: vaultHint(vault, user),
        run: () => void selectVault(vault.id),
      })),
    )
  }

  function listMenu() {
    const open = vaults.find((v) => v.id === currentVault)
    void openMenu(vaultName(), [
      ...(vaults.length > 1 ? [{ label: 'Switch vault…', run: vaultMenu }] : []),
      // Not every build can open one: iOS and Firefox have no way to.
      ...(foldersSupported() ? [{ label: 'Open folder…', run: () => void openFolder() }] : []),
      ...(open?.kind === 'local'
        ? [{ label: 'Forget this folder', hint: 'Leaves the notes on disk', run: () => void promptForgetFolder(open.id) }]
        : [{ label: 'Sync now', run: () => void syncNow() }]),
      { label: 'Sign out', run: () => void promptSignOut() },
    ])
  }

  function vaultName(): string {
    return vaults.find((v) => v.id === currentVault)?.name ?? 'quartz'
  }

  const rows = hits ? (
    hits.length === 0 ? (
      <p className="empty">Nothing matches.</p>
    ) : (
      hits.map((hit) => (
        <NoteRow
          key={hit.path}
          path={hit.path}
          title={hit.title || noteTitle(hit.path)}
          snippet={hit.snippet}
          active={hit.path === currentPath}
          swipeable={isPhone}
          open={swiped === hit.path}
          onOpenChange={(next) => setSwiped(next ? hit.path : undefined)}
          onChoose={choose}
        />
      ))
    )
  ) : (
    grouped.map(([folder, notes]) => (
      <section key={folder}>
        {folder && <h3 className="folder">{folder}</h3>}
        {notes.map((note) => (
          <NoteRow
            key={note.path}
            path={note.path}
            title={noteTitle(note.path)}
            conflict={isConflictCopy(note.path)}
            active={note.path === currentPath}
            swipeable={isPhone}
            open={swiped === note.path}
            onOpenChange={(next) => setSwiped(next ? note.path : undefined)}
            onChoose={choose}
          />
        ))}
      </section>
    ))
  )

  return (
    <aside className="sidebar" inert={inert}>
      {isPhone ? (
        <AppBar
          title={vaultName()}
          trailing={
            <button className="icon-button" onClick={listMenu} aria-label="Vault actions">
              <Ellipsis />
            </button>
          }
        />
      ) : (
        <VaultSwitcher />
      )}

      <div className="sidebar-head">
        <input
          className="search"
          value={query}
          placeholder="Search notes"
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          enterKeyHint="search"
        />
        {!isPhone && (
          <button className="icon-button" onClick={() => void newNote()} aria-label="New note" title="New note">
            <Plus />
          </button>
        )}
      </div>

      <div className="list-scroll" ref={setListFrame}>
        <div className="pull-indicator" aria-hidden="true">
          <Refresh />
        </div>
        <div className="note-list" ref={setListScroller} onScroll={() => setSwiped(undefined)}>
          {rows}
          {files.length === 0 && !hits && <p className="empty">No notes yet.</p>}
        </div>
      </div>

      {isPhone && (
        <button className="fab" onClick={() => void newNote()} aria-label="New note">
          <Plus />
        </button>
      )}
    </aside>
  )
}

interface RowProps {
  path: string
  title: string
  snippet?: string
  conflict?: boolean
  active: boolean
  swipeable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (path: string) => void
}

function NoteRow({ path, title, snippet, conflict, active, swipeable, open, onOpenChange, onChoose }: RowProps) {
  const [zone, setZone] = useState<HTMLDivElement | null>(null)
  const [action, setAction] = useState<HTMLButtonElement | null>(null)
  const handleOpenChange = useCallback((next: boolean) => onOpenChange(next), [onOpenChange])
  useSwipeToReveal(zone, action, { enabled: swipeable, width: REVEAL_PX, open, onOpenChange: handleOpenChange })

  return (
    <div className={`row-wrap ${open ? 'revealed' : ''}`} ref={setZone}>
      <button
        ref={setAction}
        className="row-action"
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        onClick={() => void promptDelete(path).then(() => onOpenChange(false))}
      >
        <Trash />
        <span>Delete</span>
      </button>
      <button
        className={`note-row ${active ? 'active' : ''}`}
        onClick={() => (open ? onOpenChange(false) : onChoose(path))}
      >
        <span className="note-text">
          <span className="note-title">
            {title}
            {conflict && <span className="tag">conflict</span>}
          </span>
          {snippet !== undefined && (
            <span
              className="note-snippet"
              // The snippet comes from the server's own FTS output, which
              // marks matches with <mark> and escapes nothing else.
              dangerouslySetInnerHTML={{ __html: sanitiseSnippet(snippet) }}
            />
          )}
        </span>
        <span className="note-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      </button>
    </div>
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
