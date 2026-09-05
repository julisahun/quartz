import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { livePreview, type LivePreviewConfig } from './live-preview'
import { keyboardAware } from './mobile'
import { editorTheme, highlighting } from './theme'
import { Wikilink } from './wikilink'

export interface EditorConfig extends LivePreviewConfig {
  onChange: (text: string) => void
  onSave: () => void
  /** Returns the vault path a pasted or dropped file was stored at. */
  onAttach: (file: File) => Promise<string>
  livePreviewEnabled: boolean
  readOnly: boolean
}

export function editorExtensions(config: EditorConfig): Extension[] {
  return [
    history(),
    keymap.of([
      { key: 'Mod-s', run: () => (config.onSave(), true), preventDefault: true },
      { key: 'Mod-b', run: (view) => wrapSelection(view, '**') },
      { key: 'Mod-i', run: (view) => wrapSelection(view, '*') },
      { key: 'Enter', run: insertNewlineContinueMarkup },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    markdown({ base: markdownLanguage, extensions: [Wikilink] }),
    EditorView.lineWrapping,
    placeholder('Start writing…'),
    editorTheme,
    highlighting,
    ...(config.livePreviewEnabled ? [livePreview(config)] : []),
    EditorState.readOnly.of(config.readOnly),
    EditorView.editable.of(!config.readOnly),
    // iOS: let the system do what it does in every other text field.
    EditorView.contentAttributes.of({
      autocapitalize: 'sentences',
      autocorrect: 'on',
      spellcheck: 'true',
      enterkeyhint: 'enter',
    }),
    attachmentHandlers(config),
    keyboardAware(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) config.onChange(update.state.doc.toString())
    }),
  ]
}

/** Wraps the selection in a marker, or unwraps it when it is already wrapped. */
function wrapSelection(view: EditorView, marker: string): boolean {
  const { state } = view
  const len = marker.length
  view.dispatch(
    state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - len), range.from)
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + len))
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        }
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      }
    }),
    { scrollIntoView: true },
  )
  return true
}

/**
 * Pasting or dropping an image stores it in the vault and leaves an embed
 * behind, the way Obsidian does — the file syncs like any other.
 */
function attachmentHandlers(config: EditorConfig): Extension {
  const insert = async (view: EditorView, files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const path = await config.onAttach(file)
      const embed = file.type.startsWith('image/') ? `![[${path}]]` : `[[${path}]]`
      const pos = view.state.selection.main.head
      view.dispatch({
        changes: { from: pos, insert: `${embed}\n` },
        selection: { anchor: pos + embed.length + 1 },
      })
    }
  }

  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = event.clipboardData?.files
      if (!files?.length) return false
      event.preventDefault()
      void insert(view, files)
      return true
    },
    drop(event, view) {
      const files = event.dataTransfer?.files
      if (!files?.length) return false
      event.preventDefault()
      void insert(view, files)
      return true
    },
  })
}
