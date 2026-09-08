// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeQuartz, type FakeQuartz } from '../fake-quartz'
import { wordCount } from '.'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

/** Renders the status item the plugin registered, over a one-note vault. */
function shown(path: string | undefined, text: string): string {
  const q: FakeQuartz = fakeQuartz(path ? { [path]: text } : {})
  q.current = path
  let render: (() => React.ReactNode) | undefined
  q.ui.statusItem = ({ render: r }) => {
    render = r
  }
  wordCount.setup(q)

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<>{render!()}</>))
  return host.textContent ?? ''
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('the word count', () => {
  it('counts the words of the open note', () => {
    expect(shown('a.md', 'one two three')).toBe('3 words')
  })

  it('says "word" when there is one', () => {
    expect(shown('a.md', 'solo')).toBe('1 word')
  })

  it('counts nothing as nothing', () => {
    expect(shown('a.md', '   \n\n')).toBe('0 words')
  })

  // Metadata is not writing, and a note whose count jumped by six because it
  // gained three properties would be lying about the work in it.
  it('leaves frontmatter out', () => {
    expect(shown('a.md', '---\ntitle: A note\ntags: [x, y]\n---\n\nreal words here')).toBe('3 words')
  })

  it('counts markup as the words it wraps', () => {
    expect(shown('a.md', '**bold** and [[a link]]')).toBe('4 words')
  })

  it('keeps hyphens and apostrophes inside one word', () => {
    expect(shown('a.md', "a well-known can't")).toBe('3 words')
  })

  it('shows nothing with no note open', () => {
    expect(shown(undefined, '')).toBe('')
  })

  it('shows nothing for an attachment', () => {
    expect(shown('handout.pdf', 'never read')).toBe('')
  })
})
