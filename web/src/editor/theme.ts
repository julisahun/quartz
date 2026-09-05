import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * The editor's look. Colours come from CSS custom properties so the app theme
 * and the editor never drift apart.
 */
export const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--editor-font-size)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-body)',
    lineHeight: '1.65',
    padding: '0 0 40vh 0',
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    maxWidth: 'var(--measure)',
    margin: '0 auto',
    // The insets keep text off the rounded corners and the notch in landscape.
    padding: '1.2rem max(1rem, env(safe-area-inset-right)) 1.2rem max(1rem, env(safe-area-inset-left))',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 2px' },

  '.cm-heading': { fontFamily: 'var(--font-heading)', fontWeight: '600', lineHeight: '1.3' },
  '.cm-h1': { fontSize: '1.7em', marginTop: '0.8em' },
  '.cm-h2': { fontSize: '1.42em', marginTop: '0.8em' },
  '.cm-h3': { fontSize: '1.22em', marginTop: '0.7em' },
  '.cm-h4': { fontSize: '1.1em' },
  '.cm-h5': { fontSize: '1em' },
  '.cm-h6': { fontSize: '0.95em', color: 'var(--muted)' },

  '.cm-strong': { fontWeight: '650' },
  '.cm-em': { fontStyle: 'italic' },
  '.cm-strike': { textDecoration: 'line-through', color: 'var(--muted)' },
  '.cm-inline-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    background: 'var(--code-bg)',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },

  '.cm-link, .cm-wikilink': { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' },
  '.cm-link:hover, .cm-wikilink:hover': { textDecoration: 'underline' },

  '.cm-quote': {
    borderLeft: '3px solid var(--border-strong)',
    paddingLeft: '0.8em',
    color: 'var(--muted)',
    fontStyle: 'italic',
  },

  '.cm-code-line': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    background: 'var(--code-bg)',
  },
  '.cm-fence-mark': { color: 'var(--faint)' },

  '.cm-bullet': { color: 'var(--accent)', paddingRight: '0.15em' },
  '.cm-task-checkbox': { verticalAlign: 'middle', marginRight: '0.45em', accentColor: 'var(--accent)' },
  '.cm-hr': { border: 'none', borderTop: '1px solid var(--border)', margin: '0.6em 0' },

  '.cm-embed-img': { maxWidth: '100%', borderRadius: '6px', display: 'block', margin: '0.4em 0' },
  '.cm-embed-missing': { color: 'var(--danger)', fontSize: '0.85em' },

  '.cm-table-wrap': { overflowX: 'auto', margin: '0.5em 0' },
  '.cm-table': { borderCollapse: 'collapse', fontSize: '0.94em', minWidth: '100%' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--border)',
    padding: '0.35em 0.6em',
    textAlign: 'left',
  },
  '.cm-table th': { background: 'var(--code-bg)', fontWeight: '600' },
  '.cm-table-source': { fontFamily: 'var(--font-mono)', fontSize: '0.88em' },

  '.cm-cursor': { borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { background: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
})

/** Syntax colours for what live preview leaves visible — mostly code. */
export const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syn-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--syn-fn)' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  ]),
)
