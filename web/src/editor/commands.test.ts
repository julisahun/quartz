// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cycleHeading,
  insertLink,
  insertWikilink,
  toggleBullet,
  toggleQuote,
  toggleTask,
  toggleWrap,
} from './commands'

let view: EditorView | undefined

afterEach(() => {
  view?.destroy()
  view = undefined
})

/** Opens a document with `|` marking the cursor, or `«…»` marking a selection. */
function open(marked: string): EditorView {
  const selection = marked.indexOf('«')
  const end = marked.indexOf('»')
  let doc: string
  let range: EditorSelection
  if (selection !== -1 && end !== -1) {
    doc = marked.slice(0, selection) + marked.slice(selection + 1, end) + marked.slice(end + 1)
    range = EditorSelection.single(selection, end - 1)
  } else {
    const cursor = marked.indexOf('|')
    doc = marked.replace('|', '')
    range = EditorSelection.single(cursor === -1 ? doc.length : cursor)
  }
  view = new EditorView({ state: EditorState.create({ doc, selection: range }), parent: document.body })
  return view
}

describe('toolbar commands', () => {
  it('wraps and unwraps the selection', () => {
    const editor = open('say «hello» there')
    toggleWrap(editor, '**')
    expect(editor.state.doc.toString()).toBe('say **hello** there')
    toggleWrap(editor, '**')
    expect(editor.state.doc.toString()).toBe('say hello there')
  })

  it('cycles a heading through three levels and back to plain', () => {
    const editor = open('title|')
    for (const expected of ['# title', '## title', '### title', 'title']) {
      cycleHeading(editor)
      expect(editor.state.doc.toString()).toBe(expected)
    }
  })

  it('turns a plain line into a bullet and back', () => {
    const editor = open('milk|')
    toggleBullet(editor)
    expect(editor.state.doc.toString()).toBe('- milk')
    toggleBullet(editor)
    expect(editor.state.doc.toString()).toBe('milk')
  })

  it('promotes a bullet to a task and strips the whole marker on the way out', () => {
    const editor = open('- milk|')
    toggleTask(editor)
    expect(editor.state.doc.toString()).toBe('- [ ] milk')
    toggleTask(editor)
    expect(editor.state.doc.toString()).toBe('milk')
  })

  it('demotes a task back to a plain bullet', () => {
    const editor = open('  - [x] milk|')
    toggleBullet(editor)
    expect(editor.state.doc.toString()).toBe('  - milk')
  })

  it('quotes every line the selection touches, and unquotes only when all are quoted', () => {
    const editor = open('«one\ntwo»\n')
    toggleQuote(editor)
    expect(editor.state.doc.toString()).toBe('> one\n> two\n')
    toggleQuote(editor)
    expect(editor.state.doc.toString()).toBe('one\ntwo\n')
  })

  it('leaves the url selected so the next keystroke replaces it', () => {
    const editor = open('see «the docs» now')
    insertLink(editor)
    expect(editor.state.doc.toString()).toBe('see [the docs](url) now')
    const { from, to } = editor.state.selection.main
    expect(editor.state.sliceDoc(from, to)).toBe('url')
  })

  it('wraps a selection in a wikilink and selects the target', () => {
    const editor = open('see «Standup» now')
    insertWikilink(editor)
    expect(editor.state.doc.toString()).toBe('see [[Standup]] now')
    const { from, to } = editor.state.selection.main
    expect(editor.state.sliceDoc(from, to)).toBe('Standup')
  })

  it('opens an empty wikilink with the cursor between the brackets', () => {
    const editor = open('link: |')
    insertWikilink(editor)
    expect(editor.state.doc.toString()).toBe('link: [[]]')
    expect(editor.state.selection.main.head).toBe(8)
  })
})
