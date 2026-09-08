import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '../api/client'
import { folderOf, noteTitle } from '../state/notes'
import { persisted } from '../state/persist'
import { useApp } from '../state/store'
import { tagMatches } from '../state/tags'
import { buildTree, foldersTo } from '../state/tree'
import { isLocal, vaultHint } from '../state/vaults'
import { foldersSupported, isFolderBacked } from '../vault/folders'
import { promptForgetFolder, promptNewFolder, promptNewNote, promptPromote } from './actions'
import { AppBar } from './AppBar'
import { openMenu } from './dialogs'
import { usePullToRefresh } from './gestures'
import { Ellipsis, Plus, Refresh } from './icons'
import { useIsPhone } from './media'
import { NoteRow, NoteTree } from './NoteTree'
import { SidebarResizer } from './SidebarResizer'
import { Slot } from './Slot'
import { VaultSwitcher } from './VaultSwitcher'

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
  const tags = useApp((s) => s.tags)
  const query = useApp((s) => s.query)
  const setQuery = useApp((s) => s.setQuery)
  const open = useApp((s) => s.open)
  const search = useApp((s) => s.search)
  const syncNow = useApp((s) => s.syncNow)
  const selectVault = useApp((s) => s.selectVault)
  const openFolder = useApp((s) => s.openFolder)
  const cloneVault = useApp((s) => s.cloneVault)
  const signedIn = useApp((s) => s.signedIn)
  const user = useApp((s) => s.user)
  const isPhone = useIsPhone()

  const [hits, setHits] = useState<SearchHit[] | undefined>()
  const [swiped, setSwiped] = useState<string | undefined>()
  const [listFrame, setListFrame] = useState<HTMLDivElement | null>(null)
  const [listScroller, setListScroller] = useState<HTMLDivElement | null>(null)

  // A query starting with "#" is a question about tags, answered from the
  // local index rather than by the server: exact, and right offline.
  const tagFilter = query.startsWith('#') ? query.slice(1).trim() : undefined

  useEffect(() => {
    const q = query.trim()
    if (!q || tagFilter !== undefined) {
      setHits(undefined)
      return
    }
    // Search as you type, but only after a pause: the server is a Pi.
    const timer = setTimeout(() => void search(q).then(setHits), 180)
    return () => clearTimeout(timer)
  }, [query, search, tagFilter])

  const refresh = useCallback(() => syncNow(), [syncNow])
  usePullToRefresh(listScroller, listFrame, { enabled: isPhone, onRefresh: refresh })

  const tree = useMemo(() => buildTree(files), [files])
  const { collapsed, toggle } = useFolders(currentVault, currentPath)

  const tagged = useMemo(() => {
    if (!tagFilter) return []
    const paths = new Set<string>()
    for (const summary of tags) {
      if (!tagMatches(summary.tag, tagFilter)) continue
      for (const path of summary.paths) paths.add(path)
    }
    return [...paths].sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)))
  }, [tags, tagFilter])

  const suggestions = useMemo(() => {
    if (tagFilter === undefined) return []
    const needle = tagFilter.toLowerCase()
    return tags.filter((t) => t.key.includes(needle)).slice(0, 30)
  }, [tags, tagFilter])

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
      // A folder at the root has no row of its own to be reached from.
      { label: 'New folder…', run: () => void promptNewFolder() },
      // Not every build can open one: iOS and Firefox have no way to.
      ...(foldersSupported() ? [{ label: 'Open folder…', run: () => void openFolder() }] : []),
      ...(open && isLocal(open)
        ? [
            // Publishing needs an account to publish to.
            ...(signedIn
              ? [{ label: 'Sync this vault…', hint: 'Copies it to the server', run: () => void promptPromote(open.id) }]
              : []),
            { label: 'Forget this folder', hint: 'Leaves the notes on disk', run: () => void promptForgetFolder(open.id) },
          ]
        : [
            { label: 'Sync now', run: () => void syncNow() },
            // One-way, and only where a folder is possible at all. A vault
            // already kept as files has nothing to offer here.
            ...(open && foldersSupported() && !isFolderBacked(open.id)
              ? [
                  {
                    label: 'Keep as files…',
                    hint: 'A folder Obsidian can open too',
                    run: () => void cloneVault(open.id),
                  },
                ]
              : []),
          ]),
      // The account is not here: signing in and out is a property of the
      // device, not of the vault this sheet is about, and it lives in settings
      // behind the gear. What is left is all things done *to* a vault.
    ])
  }

  function vaultName(): string {
    return vaults.find((v) => v.id === currentVault)?.name ?? 'Quartz'
  }

  const rowProps = {
    swipeable: isPhone,
    onChoose: choose,
  }

  let rows
  if (tagFilter !== undefined) {
    rows = (
      <>
        {suggestions.length > 0 && (
          <div className="tag-cloud">
            {suggestions.map((summary) => (
              <button
                key={summary.key}
                className={`tag-chip ${summary.key === tagFilter.toLowerCase() ? 'active' : ''}`}
                onClick={() => setQuery(`#${summary.tag}`)}
              >
                #{summary.tag}
                <span className="tag-chip-count">{summary.paths.length}</span>
              </button>
            ))}
          </div>
        )}
        {tagFilter === '' ? (
          <p className="empty">{tags.length ? 'Pick a tag.' : 'No tags in this vault yet.'}</p>
        ) : tagged.length === 0 ? (
          <p className="empty">Nothing is tagged #{tagFilter}.</p>
        ) : (
          tagged.map((path) => (
            <NoteRow
              key={path}
              path={path}
              title={noteTitle(path)}
              folder={folderOf(path)}
              active={path === currentPath}
              open={swiped === path}
              onOpenChange={(next) => setSwiped(next ? path : undefined)}
              {...rowProps}
            />
          ))
        )}
      </>
    )
  } else if (hits) {
    rows =
      hits.length === 0 ? (
        <p className="empty">Nothing matches.</p>
      ) : (
        hits.map((hit) => (
          <NoteRow
            key={hit.path}
            path={hit.path}
            title={hit.title || noteTitle(hit.path)}
            folder={folderOf(hit.path)}
            snippet={hit.snippet}
            active={hit.path === currentPath}
            open={swiped === hit.path}
            onOpenChange={(next) => setSwiped(next ? hit.path : undefined)}
            {...rowProps}
          />
        ))
      )
  } else {
    rows = (
      <NoteTree
        nodes={tree}
        depth={0}
        currentPath={currentPath}
        collapsed={collapsed}
        onToggle={toggle}
        swiped={swiped}
        onSwipe={setSwiped}
        {...rowProps}
      />
    )
  }

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
          placeholder="Search, or #tag"
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

      <Slot name="sidebar.sections" />

      <div className="list-scroll" ref={setListFrame}>
        <div className="pull-indicator" aria-hidden="true">
          <Refresh />
        </div>
        <div className="note-list" ref={setListScroller} onScroll={() => setSwiped(undefined)}>
          {rows}
          {files.length === 0 && !hits && tagFilter === undefined && <p className="empty">No notes yet.</p>}
        </div>
      </div>

      {isPhone ? (
        <button className="fab" onClick={() => void newNote()} aria-label="New note">
          <Plus />
        </button>
      ) : (
        // Only where there is a second pane to take the space from.
        <SidebarResizer />
      )}
    </aside>
  )
}

/**
 * Which folders are closed, remembered per vault.
 *
 * Opening a note opens the folders it is in — but only when the note changes,
 * so closing the folder you are working in does not spring back open under
 * your hand.
 */
function useFolders(vault: string | undefined, currentPath: string | undefined) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const expandedFor = useRef<string | undefined>(undefined)

  useEffect(() => {
    setCollapsed(new Set(vault ? persisted.collapsed(vault) : []))
    expandedFor.current = undefined
  }, [vault])

  const apply = useCallback(
    (next: Set<string>) => {
      setCollapsed(next)
      if (vault) persisted.setCollapsed(vault, [...next])
    },
    [vault],
  )

  const toggle = useCallback(
    (path: string) => {
      const next = new Set(collapsed)
      if (!next.delete(path)) next.add(path)
      apply(next)
    },
    [collapsed, apply],
  )

  useEffect(() => {
    if (!currentPath || expandedFor.current === currentPath) return
    expandedFor.current = currentPath
    const shut = foldersTo(currentPath).filter((folder) => collapsed.has(folder))
    if (shut.length === 0) return
    const next = new Set(collapsed)
    for (const folder of shut) next.delete(folder)
    apply(next)
  }, [currentPath, collapsed, apply])

  return { collapsed, toggle }
}
