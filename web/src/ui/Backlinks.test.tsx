// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Backlink } from '../state/links'
import { useApp } from '../state/store'
import { Backlinks } from './Backlinks'

// React only allows act() when it is told this is a test renderer.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

function render(state: { currentPath?: string; backlinks: Backlink[] }) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({ currentPath: state.currentPath, backlinks: state.backlinks })
  })
  root = createRoot(host)
  act(() => root!.render(<Backlinks />))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
  vi.restoreAllMocks()
})

const mention = (path: string, line = 1): Backlink => ({
  path,
  title: path.replace(/\.md$/, ''),
  line,
  context: `see [[Pi setup]]`,
})

describe('Backlinks', () => {
  it('says nothing when nothing links here', () => {
    expect(render({ currentPath: 'Pi setup.md', backlinks: [] }).textContent).toBe('')
  })

  it('stays out of the way of an attachment', () => {
    const dom = render({ currentPath: 'logo.png', backlinks: [mention('A.md')] })
    expect(dom.textContent).toBe('')
  })

  it('counts the mentions, collapsed', () => {
    const dom = render({ currentPath: 'Pi setup.md', backlinks: [mention('A.md')] })
    expect(dom.textContent).toContain('1 linked mention')
    expect(dom.querySelectorAll('.backlink')).toHaveLength(0)

    const many = render({
      currentPath: 'Pi setup.md',
      backlinks: [mention('A.md'), mention('B.md')],
    })
    expect(many.textContent).toContain('2 linked mentions')
  })

  it('expands to the notes, and opens the one you pick', () => {
    const open = vi.fn()
    act(() => useApp.setState({ open }))
    const dom = render({ currentPath: 'Pi setup.md', backlinks: [mention('daily/Monday.md', 4)] })

    act(() => dom.querySelector<HTMLButtonElement>('.backlinks-head')!.click())
    const row = dom.querySelector<HTMLButtonElement>('.backlink')
    expect(row?.textContent).toContain('daily/Monday')
    expect(row?.textContent).toContain('see [[Pi setup]]')

    act(() => row!.click())
    expect(open).toHaveBeenCalledWith('daily/Monday.md')
  })

  it('remembers whether it was left open', () => {
    const dom = render({ currentPath: 'Pi setup.md', backlinks: [mention('A.md')] })
    act(() => dom.querySelector<HTMLButtonElement>('.backlinks-head')!.click())
    expect(localStorage.getItem('backlinks')).toBe('open')

    act(() => root!.unmount())
    const reopened = render({ currentPath: 'Pi setup.md', backlinks: [mention('A.md')] })
    expect(reopened.querySelectorAll('.backlink')).toHaveLength(1)
  })
})
