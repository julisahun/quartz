// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { forceParsing, syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type Extension, type StateField } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { livePreview } from './live-preview'
import { editorExtensions } from './setup'
import { TableWidget } from './widgets'

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
        openTag: (tag) => opened.push(`#${tag}`),
      }),
    }),
    parent: document.body,
  })
  return view.dom.textContent ?? ''
}

function tables(decorations: DecorationSet): number {
  let found = 0
  decorations.between(0, 1e9, (_from, _to, deco) => {
    if (deco.spec.widget instanceof TableWidget) found++
  })
  return found
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

  it('renders the markup inside table cells, links included', () => {
    const doc = '| when | what |\n| --- | --- |\n| **now** | see [[acero\\|Acero]] |\n\nafter'
    const out = render(doc, doc.length)
    expect(out).toContain('Acero')
    expect(out).not.toContain('[[')
    expect(view!.dom.querySelector('td strong')?.textContent).toBe('now')
    expect(view!.dom.querySelector('td [data-wikilink]')?.getAttribute('data-wikilink')).toBe('acero')
  })

  it('renders frontmatter as the properties it is', () => {
    const doc = '---\nid: obj-acero\ntags: [objeto, sequia]\n---\n\n# Acero'
    const out = render(doc, doc.length)
    const table = view!.dom.querySelector('table.cm-props-table')
    expect(table).not.toBeNull()
    expect([...table!.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['id', 'tags'])
    expect(out).not.toContain('---')
    // The tags it declares are the same chips the body would show.
    expect([...table!.querySelectorAll('[data-tag]')].map((t) => t.textContent)).toEqual([
      '#objeto',
      '#sequia',
    ])
    // The heading below it is still a heading, not the tail of the block.
    expect(view!.dom.querySelector('.cm-h1')).not.toBeNull()
  })

  it('gives the frontmatter back as YAML when the cursor is in it', () => {
    const doc = '---\nid: obj-acero\n---\n\n# Acero'
    const out = render(doc, 6)
    expect(view!.dom.querySelector('table.cm-props-table')).toBeNull()
    expect(out).toContain('id: obj-acero')
  })

  it('leaves an unclosed block alone — it is not frontmatter yet', () => {
    const out = render('---\nid: half-typed\n\nbody', 24)
    expect(view!.dom.querySelector('table.cm-props-table')).toBeNull()
    expect(out).toContain('id: half-typed')
  })

  it('renders tags as chips that carry their target', () => {
    const doc = '# Acero\n\n#objeto #pnj/roquena\n\nbody'
    const out = render(doc, doc.length)
    const chips = [...view!.dom.querySelectorAll('.cm-tag')]
    expect(chips.map((c) => c.getAttribute('data-tag'))).toEqual(['objeto', 'pnj/roquena'])
    // The "#" stays: a tag without it is just a word.
    expect(out).toContain('#objeto')
  })

  it('does not mistake a heading, a url fragment or a number for a tag', () => {
    const doc = '# Heading\n\nsee https://host/#anchor and issue #1\n\nx'
    render(doc, doc.length)
    expect(view!.dom.querySelectorAll('.cm-tag')).toHaveLength(0)
  })

  it('rounds a code fence off at its first and last line', () => {
    render('```js\nconst a = 1\n```\n\nx', 23)
    expect(view!.dom.querySelectorAll('.cm-code-line')).toHaveLength(3)
    expect(view!.dom.querySelectorAll('.cm-code-first')).toHaveLength(1)
    expect(view!.dom.querySelectorAll('.cm-code-last')).toHaveLength(1)
  })

  it('decorates what the parser only reaches later', () => {
    // CodeMirror parses a screenful at a time and finishes the rest in the
    // background. The transaction carrying the finished tree changes neither
    // the document nor the selection, so a preview that only watched those two
    // left everything past the first screen as raw markdown until you typed.
    const doc = `${'filler paragraph, long enough to push the parser past it\n\n'.repeat(400)}| a | b |\n| --- | --- |\n| 1 | 2 |\n`
    const [field] = livePreview({
      resolveAsset: async () => undefined,
      openWikilink: () => {},
      openUrl: () => {},
      openTag: () => {},
    }) as Extension[]
    const decorated = field as StateField<{ decorations: DecorationSet }>

    view = new EditorView({
      state: EditorState.create({
        doc,
        selection: EditorSelection.cursor(0),
        extensions: [markdown({ base: markdownLanguage }), decorated],
      }),
      parent: document.body,
    })

    // The premise: the table is past where the first parse stopped.
    expect(syntaxTree(view.state).length).toBeLessThan(doc.length)
    expect(tables(view.state.field(decorated).decorations)).toBe(0)

    forceParsing(view, doc.length, 10_000)
    expect(tables(view.state.field(decorated).decorations)).toBe(1)
  })

  it('leaves the document untouched — preview never rewrites the source', () => {
    const doc = '# Title\n\n- [ ] task\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    render(doc, doc.length)
    expect(view!.state.doc.toString()).toBe(doc)
  })
})
