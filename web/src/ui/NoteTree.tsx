import { useCallback, useState, type DragEvent } from 'react'
import { isConflictCopy, type FileKind } from '../state/notes'
import type { TreeNode } from '../state/tree'
import { folderMenu, moveTo, promptDelete, rowMenu } from './actions'
import { useLongPress, useSwipeToReveal } from './gestures'
import { ChevronDown, ChevronRight, Ellipsis, FileText, Photo, Trash } from './icons'

/** How much of the delete button a swipe uncovers. */
const REVEAL_PX = 92
/** How far each level of the tree steps in. */
const INDENT_REM = 0.85
/** What a row being dragged carries: its path, under a type nothing else uses. */
export const DRAG_TYPE = 'application/x-quartz-path'

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
 *
 * It is a tree to a screen reader as well — folders are expandable items with
 * their notes as a group — and the sidebar walks it with the arrow keys.
 */
export function NoteTree(props: TreeProps) {
  return (
    <>
      {props.nodes.map((node) =>
        node.kind === 'folder' ? (
          <FolderNode key={`d:${node.path}`} node={node} {...props} />
        ) : (
          <NoteRow
            key={node.path}
            path={node.path}
            title={node.title}
            indent={props.depth}
            level={props.depth + 1}
            fileKind={node.fileKind}
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

function FolderNode({ node, ...props }: TreeProps & { node: Extract<TreeNode, { kind: 'folder' }> }) {
  const { depth, collapsed, onToggle } = props
  const [line, setLine] = useState<HTMLDivElement | null>(null)
  const [dropping, setDropping] = useState(false)
  const shut = collapsed.has(node.path)
  const showMenu = useCallback(() => void folderMenu(node.path), [node.path])
  useLongPress(line, { enabled: props.swipeable, onLongPress: showMenu })

  // Dropping a row on a folder moves it there. Only on a desktop: on a phone
  // a drag is a scroll, and "Move to…" is the way.
  const drop = props.swipeable
    ? {}
    : {
        onDragOver: (event: DragEvent) => {
          if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropping(true)
        },
        onDragLeave: () => setDropping(false),
        onDrop: (event: DragEvent) => {
          setDropping(false)
          const path = event.dataTransfer.getData(DRAG_TYPE)
          if (!path) return
          event.preventDefault()
          event.stopPropagation()
          void moveTo(path, node.path)
        },
      }

  return (
    <div className="tree-folder" role="none">
      {/* The row toggles and the ⋯ acts, so they are two buttons rather
          than one with a hit test in it — a folder's actions must not be
          reachable only by opening it. */}
      <div
        className={`folder-line ${dropping ? 'drop-target' : ''}`}
        ref={setLine}
        role="none"
        onContextMenu={(event) => {
          event.preventDefault()
          showMenu()
        }}
        {...drop}
      >
        <button
          className="folder-row"
          role="treeitem"
          aria-level={depth + 1}
          data-folder={node.path}
          style={{ paddingLeft: `${0.5 + depth * INDENT_REM}rem` }}
          onClick={() => onToggle(node.path)}
          aria-expanded={!shut}
        >
          <span className="folder-caret" aria-hidden="true">
            {shut ? <ChevronRight /> : <ChevronDown />}
          </span>
          <span className="folder-name">{node.name}</span>
          {shut && <span className="folder-count">{node.count}</span>}
        </button>
        <button
          className="icon-button folder-actions"
          // Out of the arrow-key walk: the menu is also on the context-menu
          // key, and a tab stop per folder would make the tree a slog.
          tabIndex={-1}
          onClick={showMenu}
          aria-label={`Actions for ${node.name}`}
          title={`Actions for ${node.name}`}
        >
          <Ellipsis />
        </button>
      </div>
      {!shut && (
        <div role="group">
          <NoteTree {...props} nodes={node.children} depth={depth + 1} />
        </div>
      )}
    </div>
  )
}

/** What a non-note row calls itself, to a reader and to a screen reader. */
const KIND_LABEL: Record<FileKind, string> = {
  note: 'Note',
  pdf: 'PDF',
  image: 'Image',
  other: 'Attachment',
}

interface RowProps {
  path: string
  title: string
  /** Where in the tree it sits; search results and tag hits sit at the margin. */
  indent?: number
  /** Its depth as a tree item. Absent outside the tree — in search results. */
  level?: number
  /**
   * A PDF or an image is listed beside the notes, and carries an icon so it is
   * not mistaken for one. A note is the default and gets none.
   */
  fileKind?: FileKind
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
  level,
  fileKind = 'note',
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
  const showMenu = useCallback(() => void rowMenu(path, onChoose), [path, onChoose])
  useLongPress(zone, { enabled: swipeable, onLongPress: showMenu })

  const inTree = level !== undefined

  return (
    <div className={`row-wrap ${open ? 'revealed' : ''}`} ref={setZone} role="none">
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
        role={inTree ? 'treeitem' : undefined}
        aria-level={level}
        aria-selected={inTree ? active : undefined}
        aria-current={!inTree && active ? 'page' : undefined}
        data-path={path}
        style={indent ? { paddingLeft: `${0.6 + indent * INDENT_REM}rem` } : undefined}
        onClick={() => (open ? onOpenChange(false) : onChoose(path))}
        onContextMenu={(event) => {
          event.preventDefault()
          showMenu()
        }}
        draggable={!swipeable}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, path)
          event.dataTransfer.effectAllowed = 'move'
        }}
      >
        {fileKind !== 'note' && (
          <span className="note-icon" aria-label={KIND_LABEL[fileKind]} title={KIND_LABEL[fileKind]}>
            {fileKind === 'image' ? <Photo /> : <FileText />}
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
