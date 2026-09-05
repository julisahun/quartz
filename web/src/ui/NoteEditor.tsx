import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { editorExtensions } from '../editor/setup'
import { resolveWikilink, pathForTitle, isNote } from '../state/notes'
import { useApp } from '../state/store'

interface Props {
  livePreview: boolean
}

export function NoteEditor({ livePreview }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView>(null)
  const currentPath = useApp((s) => s.currentPath)
  const content = useApp((s) => s.content)

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
          } else {
            // Following a link to a note that does not exist creates it, which
            // is how a vault actually grows.
            void state.createNote(pathForTitle(target).replace(/\.md$/, ''))
          }
        },
        openUrl: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
      }),
    })

    const editor = new EditorView({ state, parent: host.current })
    view.current = editor
    editor.focus()

    return () => {
      for (const url of assetUrls.values()) URL.revokeObjectURL(url)
      editor.destroy()
      view.current = null
    }
  }, [currentPath, livePreview])

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

  if (!currentPath) {
    return (
      <div className="editor-empty">
        <p>Pick a note, or make one.</p>
      </div>
    )
  }

  if (!isNote(currentPath)) {
    return (
      <div className="editor-empty">
        <p>{currentPath} is an attachment, not a note.</p>
      </div>
    )
  }

  return <div className="editor" ref={host} />
}
