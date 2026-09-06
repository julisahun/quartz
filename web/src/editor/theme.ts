import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * The editor's look. Colours come from CSS custom properties so the app theme
 * and the editor never drift apart.
 *
 * One rule holds this file together: **no vertical margins, anywhere**.
 * CodeMirror measures every block with `getBoundingClientRect()`, which does
 * not include margins, so a margin makes the editor's height map disagree with
 * the layout — and a click then lands a line below where it was aimed. Space
 * above a heading or around a table is padding instead. `themeSpec` is
 * exported so a test can hold the line.
 */
export const themeSpec = {
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
  '.cm-h1': { fontSize: '1.7em', paddingTop: '0.8em' },
  '.cm-h2': { fontSize: '1.42em', paddingTop: '0.8em' },
  '.cm-h3': { fontSize: '1.22em', paddingTop: '0.7em' },
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

  // A fenced block reads as one slab: every line shares the background, and
  // the first and last round the corners off it.
  '.cm-code-line': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    background: 'var(--code-bg)',
    paddingLeft: '0.7em',
    paddingRight: '0.7em',
  },
  '.cm-code-first': { paddingTop: '0.4em', borderRadius: '8px 8px 0 0' },
  '.cm-code-last': { paddingBottom: '0.4em', borderRadius: '0 0 8px 8px' },
  '.cm-fence-mark': { color: 'var(--faint)' },

  '.cm-tag': {
    color: 'var(--accent)',
    background: 'var(--tag-bg)',
    borderRadius: '999px',
    padding: '0.05em 0.5em',
    fontSize: '0.85em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  '.cm-tag:hover': { background: 'var(--tag-bg-hover)' },

  '.cm-bullet': { color: 'var(--accent)', paddingRight: '0.15em' },
  '.cm-task-checkbox': { verticalAlign: 'middle', marginRight: '0.45em', accentColor: 'var(--accent)' },
  // The rule itself has no room of its own; the line it sits on provides it,
  // where CodeMirror can see it.
  '.cm-hr-line': { paddingTop: '0.55em', paddingBottom: '0.55em' },
  '.cm-hr': { border: 'none', borderTop: '1px solid var(--border)', margin: '0' },

  '.cm-embed': { display: 'block', paddingTop: '0.4em', paddingBottom: '0.4em' },
  '.cm-embed-img': { maxWidth: '100%', borderRadius: '6px', display: 'block' },
  '.cm-embed-missing': { color: 'var(--danger)', fontSize: '0.85em' },

  '.cm-table-wrap': { overflowX: 'auto', paddingTop: '0.5em', paddingBottom: '0.5em' },
  '.cm-table': { borderCollapse: 'collapse', fontSize: '0.94em', minWidth: '100%' },
  '.cm-table th, .cm-table td': {
    border: '1px solid var(--border)',
    padding: '0.35em 0.6em',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.cm-table th': { background: 'var(--code-bg)', fontWeight: '600' },
  '.cm-table-source': { fontFamily: 'var(--font-mono)', fontSize: '0.88em' },

  // Frontmatter, rendered as the properties it is.
  '.cm-props': {
    paddingTop: '0.2em',
    paddingBottom: '0.9em',
  },
  '.cm-props-table': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.9em',
    background: 'var(--code-bg)',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  '.cm-props-table th': {
    width: '9rem',
    padding: '0.3em 0.7em',
    textAlign: 'left',
    verticalAlign: 'top',
    fontWeight: '500',
    color: 'var(--muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.92em',
  },
  '.cm-props-table td': { padding: '0.3em 0.7em', verticalAlign: 'top' },
  '.cm-props-table tr + tr th, .cm-props-table tr + tr td': {
    borderTop: '1px solid var(--border)',
  },
  '.cm-props-list': { display: 'flex', flexDirection: 'column', gap: '0.25em' },
  '.cm-props-item': { display: 'block' },
  '.cm-props-empty': { color: 'var(--faint)' },
  '.cm-frontmatter-source': { fontFamily: 'var(--font-mono)', fontSize: '0.88em', color: 'var(--muted)' },

  '.cm-cursor': { borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': { background: 'var(--selection) !important' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
}

export const editorTheme = EditorView.theme(themeSpec)

/** Syntax colours for what live preview leaves visible — mostly code. */
export const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syn-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--syn-string)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--faint)', fontStyle: 'italic' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--syn-number)' },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: 'var(--syn-fn)' },
    { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syn-type)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--syn-prop)' },
    { tag: [tags.operator, tags.punctuation, tags.derefOperator], color: 'var(--muted)' },
    { tag: tags.monospace, fontFamily: 'var(--font-mono)' },
  ]),
)
