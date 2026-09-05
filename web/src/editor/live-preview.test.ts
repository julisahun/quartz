// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { editorExtensions } from './setup'

let view: EditorView | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
})

/**
 * Renders a document and returns the text the reader actually sees.
 * The cursor defaults to the end, i.e. away from whatever is being asserted.
 */
function render(doc: string, cursor = doc.length): string {
  const opened: string[] = []
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(Math.min(cursor, doc.length)),
      extensions: editorExtensions({
        livePreviewEnabled: true,
        readOnly: false,
        onChange: () => {},
        onSave: () => {},
        onAttach: async () => 'attachments/x.png',
        resolveAsset: async () => 'blob:fake',
        openWikilink: (target) => opened.push(target),
        openUrl: (url) => opened.push(url),
      }),
    }),
    parent: document.body,
  })
  return view.dom.textContent ?? ''
}

describe('live preview', () => {
  it('hides heading markers but keeps the text', () => {
    // The cursor sits at the end of the document, away from the heading.
    expect(render('# Title\n\nbody', 10)).toContain('Title')
    expect(render('# Title\n\nbody', 10)).not.toContain('# Title')
  })

  it('brings the markup back on the line being edited', () => {
    expect(render('# Title\n\nbody', 2)).toContain('# Title')
  })

  it('hides emphasis markers', () => {
    const out = render('a **bold** and *italic* and ~~gone~~ word\n\nx', 42)
    expect(out).toContain('bold')
    expect(out).toContain('italic')
    expect(out).not.toContain('**bold**')
    expect(out).not.toContain('~~gone~~')
  })

  it('hides backticks around inline code', () => {
    const out = render('use `npm ci` here\n\nx', 20)
    expect(out).toContain('npm ci')
    expect(out).not.toContain('`npm ci`')
  })

  it('renders task checkboxes and plain bullets', () => {
    const out = render('- [ ] open\n- [x] done\n- plain\n\nx')
    expect(out).toContain('open')
    expect(out).toContain('done')
    expect(out).not.toContain('[ ]')
    expect(out).not.toContain('[x]')
    expect(out).toContain('•')
    expect(view!.dom.querySelectorAll('input.cm-task-checkbox')).toHaveLength(2)
    const boxes = view!.dom.querySelectorAll<HTMLInputElement>('input.cm-task-checkbox')
    expect(boxes[0].checked).toBe(false)
    expect(boxes[1].checked).toBe(true)
  })

  it('toggles a checkbox from a click', () => {
    render('- [ ] open\n\nx', 12)
    const box = view!.dom.querySelector<HTMLInputElement>('input.cm-task-checkbox')!
    box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(view!.state.doc.toString()).toBe('- [x] open\n\nx')
  })

  it('shows link text without the url, and keeps the target for clicks', () => {
    const out = render('see [the docs](https://example.com/x) now\n\nx', 42)
    expect(out).toContain('the docs')
    expect(out).not.toContain('https://example.com/x')
    expect(view!.dom.querySelector('[data-href]')?.getAttribute('data-href')).toBe(
      'https://example.com/x',
    )
  })

  it('renders wikilinks without brackets and keeps the target', () => {
    const out = render('go to [[Pi setup]] now\n\nx', 24)
    expect(out).toContain('Pi setup')
    expect(out).not.toContain('[[Pi setup]]')
    expect(view!.dom.querySelector('[data-wikilink]')?.getAttribute('data-wikilink')).toBe('Pi setup')
  })

  it('shows only the display half of a piped wikilink', () => {
    const out = render('see [[notes/Pi setup|the pi]] ok\n\nx', 34)
    expect(out).toContain('the pi')
    expect(out).not.toContain('notes/Pi setup|')
    expect(view!.dom.querySelector('[data-wikilink]')?.getAttribute('data-wikilink')).toBe(
      'notes/Pi setup',
    )
  })

  it('embeds images from the vault', () => {
    render('![[attachments/pic.png]]\n\nx', 26)
    expect(view!.dom.querySelector('img.cm-embed-img')).not.toBeNull()
  })

  it('hides quote markers and marks the line', () => {
    const out = render('> quoted line\n\nx', 15)
    expect(out).toContain('quoted line')
    expect(out).not.toContain('> quoted')
    expect(view!.dom.querySelector('.cm-quote')).not.toBeNull()
  })

  it('keeps code fences visible but styled', () => {
    const out = render('```js\nconst a = 1\n```\n\nx', 23)
    expect(out).toContain('const a = 1')
    expect(view!.dom.querySelector('.cm-code-line')).not.toBeNull()
  })

  it('renders a table when the cursor is elsewhere', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter'
    render(doc, doc.length)
    const table = view!.dom.querySelector('table.cm-table')
    expect(table).not.toBeNull()
    expect(table!.querySelectorAll('th')).toHaveLength(2)
    expect(table!.querySelectorAll('tbody td')).toHaveLength(2)
  })

  it('returns the table to source when the cursor enters it', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter'
    const out = render(doc, 3)
    expect(view!.dom.querySelector('table.cm-table')).toBeNull()
    expect(out).toContain('| a | b |')
  })

  it('replaces a horizontal rule with a rule', () => {
    render('above\n\n---\n\nbelow', 17)
    expect(view!.dom.querySelector('hr.cm-hr')).not.toBeNull()
  })

  it('handles constructs nested in each other', () => {
    const doc = '> - [ ] a **bold** task with [[a link]]\n\nx'
    const out = render(doc, doc.length)
    expect(out).toContain('bold')
    expect(out).toContain('a link')
    expect(out).not.toContain('**')
    expect(out).not.toContain('[[')
    expect(view!.dom.querySelector('input.cm-task-checkbox')).not.toBeNull()
    expect(view!.dom.querySelector('.cm-quote')).not.toBeNull()
  })

  it('leaves the document untouched — preview never rewrites the source', () => {
    const doc = '# Title\n\n- [ ] task\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    render(doc, doc.length)
    expect(view!.state.doc.toString()).toBe(doc)
  })
})
