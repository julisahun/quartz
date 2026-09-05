import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { insertAttachments, toggleWrap } from './commands'
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
      { key: 'Mod-b', run: (view) => toggleWrap(view, '**') },
      { key: 'Mod-i', run: (view) => toggleWrap(view, '*') },
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

/**
 * Pasting or dropping a file stores it in the vault and leaves an embed
 * behind. The toolbar's picker goes through the same path.
 */
function attachmentHandlers(config: EditorConfig): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = event.clipboardData?.files
      if (!files?.length) return false
      event.preventDefault()
      void insertAttachments(view, Array.from(files), config.onAttach)
      return true
    },
    drop(event, view) {
      const files = event.dataTransfer?.files
      if (!files?.length) return false
      event.preventDefault()
      void insertAttachments(view, Array.from(files), config.onAttach)
      return true
    },
  })
}
