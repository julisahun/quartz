import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'
import { editorExtensions } from '../editor/setup'
import { resolveWikilink, pathForTitle, isNote, isPdf, mimeType, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { promptDelete, promptRename } from './actions'
import { AppBar } from './AppBar'
import { Backlinks } from './Backlinks'
import { openMenu } from './dialogs'
import { EditorToolbar } from './EditorToolbar'
import { ChevronLeft, Ellipsis } from './icons'
import { useIsPhone } from './media'
import { PdfView } from './PdfView'

interface Props {
  livePreview: boolean
  onToggleLivePreview: () => void
  onBack: () => void
}

export function NoteEditor({ livePreview, onToggleLivePreview, onBack }: Props) {
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

  function noteMenu() {
    if (!currentPath) return
    void openMenu(noteTitle(currentPath), [
      // Nothing to preview in a PDF, and nothing to write in it either.
      ...(isNote(currentPath)
        ? [
            {
              label: livePreview ? 'Source view' : 'Live preview',
              hint: livePreview ? 'Show the markdown as written' : 'Hide the markup while writing',
              run: onToggleLivePreview,
            },
          ]
        : []),
      { label: 'Rename…', run: () => void promptRename(currentPath) },
      {
        label: 'Delete',
        danger: true,
        run: () => void promptDelete(currentPath).then((done) => done && onBack()),
      },
    ])
  }

  let body
  if (!currentPath) {
    body = (
      <div className="editor-empty">
        <p>Pick a note, or make one.</p>
      </div>
    )
  } else if (isPdf(currentPath)) {
    body = <PdfView path={currentPath} />
  } else if (!isNote(currentPath)) {
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
        {body}
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
      <Backlinks />
      <EditorToolbar view={toolbarView} />
    </>
  )
}
