import { useCallback, useState } from 'react'
import { isConflictCopy } from '../state/notes'
import type { TreeNode } from '../state/tree'
import { promptDelete } from './actions'
import { useSwipeToReveal } from './gestures'
import { ChevronDown, ChevronRight, FileText, Trash } from './icons'

/** How much of the delete button a swipe uncovers. */
const REVEAL_PX = 92
/** How far each level of the tree steps in. */
const INDENT_REM = 0.85

interface TreeProps {
  nodes: TreeNode[]
  depth: number
  currentPath: string | undefined
  collapsed: Set<string>
  onToggle: (path: string) => void
  onChoose: (path: string) => void
  swipeable: boolean
  swiped: string | undefined
  onSwipe: (path: string | undefined) => void
}

/**
 * The vault's folders, as folders.
 *
 * Open by default and closed on purpose: a vault you have just signed into
 * shows you everything it has, and what you close stays closed. Opening a note
 * opens the folders it is in — following a `[[link]]` into a corner of the
 * vault should show you which corner.
 */
export function NoteTree(props: TreeProps) {
  const { nodes, depth, collapsed, onToggle } = props

  return (
    <>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <div key={`d:${node.path}`} className="tree-folder">
            <button
              className="folder-row"
              style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
              onClick={() => onToggle(node.path)}
              aria-expanded={!collapsed.has(node.path)}
            >
              <span className="folder-caret" aria-hidden="true">
                {collapsed.has(node.path) ? <ChevronRight /> : <ChevronDown />}
              </span>
              <span className="folder-name">{node.name}</span>
              {collapsed.has(node.path) && <span className="folder-count">{node.count}</span>}
            </button>
            {!collapsed.has(node.path) && <NoteTree {...props} nodes={node.children} depth={depth + 1} />}
          </div>
        ) : (
          <NoteRow
            key={node.path}
            path={node.path}
            title={node.title}
            indent={depth}
            pdf={node.pdf}
            conflict={isConflictCopy(node.path)}
            active={node.path === props.currentPath}
            swipeable={props.swipeable}
            open={props.swiped === node.path}
            onOpenChange={(next) => props.onSwipe(next ? node.path : undefined)}
            onChoose={props.onChoose}
          />
        ),
      )}
    </>
  )
}

interface RowProps {
  path: string
  title: string
  /** Where in the tree it sits; search results and tag hits sit at the margin. */
  indent?: number
  /** A PDF is listed beside the notes, and marked so it is not mistaken for one. */
  pdf?: boolean
  /** The folder it is in, worth showing when the rows are not in one. */
  folder?: string
  snippet?: string
  conflict?: boolean
  active: boolean
  swipeable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (path: string) => void
}

export function NoteRow({
  path,
  title,
  indent = 0,
  pdf,
  folder,
  snippet,
  conflict,
  active,
  swipeable,
  open,
  onOpenChange,
  onChoose,
}: RowProps) {
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
        style={indent ? { paddingLeft: `${0.6 + indent * INDENT_REM}rem` } : undefined}
        onClick={() => (open ? onOpenChange(false) : onChoose(path))}
      >
        {pdf && (
          <span className="note-icon" aria-label="PDF" title="PDF">
            <FileText />
          </span>
        )}
        <span className="note-text">
          <span className="note-title">
            {title}
            {conflict && <span className="tag">conflict</span>}
          </span>
          {folder && <span className="note-folder">{folder}</span>}
          {snippet !== undefined && (
            <span
              className="note-snippet"
              // The snippet comes from the server's own FTS output, which
              // marks matches with <mark> and escapes nothing else.
              dangerouslySetInnerHTML={{ __html: sanitiseSnippet(snippet) }}
            />
          )}
        </span>
        {/* On a phone the row opens a screen, and the chevron says so. */}
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
