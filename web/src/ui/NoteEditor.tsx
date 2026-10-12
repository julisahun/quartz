import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { editorExtensions } from '../editor/setup'
import { headings } from '../editor/outline'
import { resolveWikilink, pathForTitle, fileKind, folderOf, isNote, mimeType, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { fileActions, promptNewNote, promptRename } from './actions'
import { AppBar } from './AppBar'
import { Backlinks } from './Backlinks'
import { openMenu, type MenuItem } from './dialogs'
import { EditorToolbar } from './EditorToolbar'
import { ChevronLeft, Ellipsis } from './icons'
import { shortcut, useIsPhone } from './media'
import { ImageView } from './ImageView'
import { PdfView } from './PdfView'
import { Slot } from './Slot'

interface Props {
  livePreview: boolean
  onToggleLivePreview: () => void
  onBack: () => void
  /** Opens ⌘P, for the empty pane's "Find a note". */
  onQuickOpen: () => void
}

export function NoteEditor({ livePreview, onToggleLivePreview, onBack, onQuickOpen }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const [toolbarView, setToolbarView] = useState<EditorView | null>(null)
  const currentPath = useApp((s) => s.currentPath)
  const content = useApp((s) => s.content)
  const isPhone = useIsPhone()

  // The editor is rebuilt when the note or the mode changes, and only then:
  // rebuilding on every keystroke would throw away undo history and scroll.
  useEffect(() => {
    if (!host.current || !currentPath) return

    const app = useApp.getState()
    const assetUrls = new Map<string, string>()

    const state = EditorState.create({
      doc: app.content,
      extensions: editorExtensions({
        livePreviewEnabled: livePreview,
        readOnly: false,
        onChange: (text) => useApp.getState().edit(text),
        onSave: () => void useApp.getState().save(),
        onAttach: (file) => useApp.getState().attach(file),
        resolveAsset: async (path) => {
          const cached = assetUrls.get(path)
          if (cached) return cached
          const resolved = resolveWikilink(path, useApp.getState().files) ?? path
          const url = await useApp.getState().blobUrl(resolved)
          if (url) assetUrls.set(path, url)
          return url
        },
        openWikilink: (target) => {
          const state = useApp.getState()
          const found = resolveWikilink(target, state.files)
          if (found) {
            void state.open(found)
            return
          }
          // A link naming a file — carta.pdf, diagram.png — meant that file.
          // Creating carta.pdf.md instead would be a note nobody asked for.
          if (!isNote(target) && mimeType(target) !== 'application/octet-stream') {
            state.notify('error', `${target} is not in this vault`)
            return
          }
          // Following a link to a note that does not exist creates it, which
          // is how a vault actually grows.
          void state.createNote(pathForTitle(target).replace(/\.md$/, ''))
        },
        openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
        openTag: (tag) => {
          // A tag is a question about the vault, and the note list is where it
          // gets answered — so on a phone, clicking one goes back to it.
          useApp.getState().setQuery(`#${tag}`)
          if (isPhone) onBack()
        },
      }),
    })

    const editor = new EditorView({ state, parent: host.current })
    view.current = editor
    setToolbarView(editor)
    // Opening a note on a phone is usually reading, not writing: taking focus
    // here would throw the keyboard over half of what was just opened.
    if (!isPhone) editor.focus()

    return () => {
      for (const url of assetUrls.values()) URL.revokeObjectURL(url)
      editor.destroy()
      view.current = null
      setToolbarView(null)
    }
  }, [currentPath, livePreview, isPhone, onBack])

  // A pulled change to the open note: replace the text without disturbing the
  // cursor more than necessary.
  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const shown = editor.state.doc.toString()
    if (shown === content) return
    const selection = editor.state.selection.main
    editor.dispatch({
      changes: { from: 0, to: shown.length, insert: content },
      selection: { anchor: Math.min(selection.anchor, content.length) },
    })
  }, [content])

  /** The headings as a menu: picking one scrolls the editor to it. */
  function outline() {
    const editor = view.current
    if (!editor || !currentPath) return
    const found = headings(editor.state.doc.toString())
    if (found.length === 0) {
      useApp.getState().notify('info', `${noteTitle(currentPath)} has no headings yet.`)
      return
    }
    const top = Math.min(...found.map((h) => h.level))
    void openMenu(
      'Outline',
      found.map((heading) => ({
        label: `${'\u2003'.repeat(heading.level - top)}${heading.text}`,
        run: () => {
          const line = editor.state.doc.line(heading.line)
          editor.dispatch({
            selection: { anchor: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }),
          })
          // Not on a phone: focus there throws the keyboard over the heading.
          if (!isPhone) editor.focus()
        },
      })),
    )
  }

  function noteMenu() {
    if (!currentPath) return
    const writing: MenuItem[] = isNote(currentPath)
      ? [
          {
            label: livePreview ? 'Source view' : 'Live preview',
            hint: livePreview ? 'Show the markdown as written' : 'Hide the markup while writing',
            run: onToggleLivePreview,
          },
          { label: 'Outline…', hint: 'Jump to a heading', run: outline },
        ]
      : // Nothing to preview in a PDF or an image, and nothing to write in one either.
        []
    void openMenu(noteTitle(currentPath), [...writing, ...fileActions(currentPath, { onDeleted: onBack })])
  }

  let body
  const kind = currentPath ? fileKind(currentPath) : undefined
  if (!currentPath) {
    body = <EmptyPane onQuickOpen={onQuickOpen} />
  } else if (kind === 'pdf') {
    body = <PdfView path={currentPath} />
  } else if (kind === 'image') {
    body = <ImageView path={currentPath} />
  } else if (kind === 'other') {
    body = (
      <div className="editor-empty">
        <p>{currentPath} is an attachment, not a note.</p>
      </div>
    )
  } else {
    body = <div className="editor" ref={host} />
  }

  if (!isPhone) {
    return (
      <>
        {currentPath && kind === 'note' && (
          <NoteHeader
            path={currentPath}
            livePreview={livePreview}
            onToggleLivePreview={onToggleLivePreview}
            onMenu={noteMenu}
          />
        )}
        {body}
        <Slot name="note.panels" />
        <Backlinks />
      </>
    )
  }

  return (
    <>
      <AppBar
        leading={
          <button className="icon-button" onClick={onBack} aria-label="Back to the note list">
            <ChevronLeft />
            <span className="icon-button-text">Notes</span>
          </button>
        }
        title={currentPath ? noteTitle(currentPath) : ''}
        trailing={
          currentPath && (
            <button className="icon-button" onClick={noteMenu} aria-label="Note actions">
              <Ellipsis />
            </button>
          )
        }
      />
      {body}
      <Slot name="note.panels" />
      <Backlinks />
      <EditorToolbar view={toolbarView} />
    </>
  )
}

/**
 * The note's own bar on a desktop: where it is, what it is called, how it is
 * being shown, and what can be done to it — the same ⋯ the phone has. The
 * title is the rename: it is where anyone would click to change it.
 */
function NoteHeader({
  path,
  livePreview,
  onToggleLivePreview,
  onMenu,
}: {
  path: string
  livePreview: boolean
  onToggleLivePreview: () => void
  onMenu: () => void
}) {
  const folder = folderOf(path)
  return (
    <header className="note-head">
      <div className="note-head-text">
        {folder && (
          <span className="note-head-folder" title={folder}>
            {folder.split('/').join(' / ')} /
          </span>
        )}
        <button className="note-head-title" onClick={() => void promptRename(path)} title="Rename">
          {noteTitle(path)}
        </button>
      </div>
      <button
        className="mode-toggle"
        role="switch"
        aria-checked={livePreview}
        onClick={onToggleLivePreview}
        title={livePreview ? 'Showing the note formatted. Switch off to see the markdown as written.' : 'Showing the markdown as written.'}
      >
        <span className="switch" aria-hidden="true" />
        Live preview
      </button>
      <button className="icon-button" onClick={onMenu} aria-label="Note actions" title="Note actions">
        <Ellipsis />
      </button>
    </header>
  )
}

/** How many recently edited notes the empty pane offers. */
const RECENT = 6

/**
 * Nothing open. Rather than only saying so, it offers the ways forward: a
 * new note, the switcher, and the notes touched last — with the shortcuts
 * shown, since nothing else on screen mentions them.
 */
function EmptyPane({ onQuickOpen }: { onQuickOpen: () => void }) {
  const files = useApp((s) => s.files)
  const open = useApp((s) => s.open)
  const recent = [...files]
    .filter((file) => isNote(file.path))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, RECENT)

  return (
    <div className="editor-empty">
      <div className="welcome">
        <p className="welcome-lede">Pick a note, or make one.</p>
        <div className="welcome-actions">
          <button className="button primary" onClick={() => void promptNewNote()}>
            New note <kbd>{shortcut('N')}</kbd>
          </button>
          <button className="button" onClick={onQuickOpen}>
            Find a note <kbd>{shortcut('P')}</kbd>
          </button>
        </div>
        {recent.length > 0 && (
          <section className="welcome-recent">
            <h2>Recently edited</h2>
            <ul>
              {recent.map((file) => (
                <li key={file.path}>
                  <button onClick={() => void open(file.path)}>
                    <span className="welcome-recent-title">{noteTitle(file.path)}</span>
                    {folderOf(file.path) && <span className="welcome-recent-folder">{folderOf(file.path)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="welcome-hint">
          Type <kbd>&gt;</kbd> in {shortcut('P')} for every command.
        </p>
      </div>
    </div>
  )
}
