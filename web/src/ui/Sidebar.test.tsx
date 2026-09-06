// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import type { TagSummary } from '../state/vault-index'
import type { FileMeta } from '../vault/types'
import { Sidebar } from './Sidebar'

// React only allows act() when it is told this is a test renderer.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const files = (...paths: string[]): FileMeta[] =>
  paths.map((path) => ({ path, hash: 'h', size: 0, mtime: 0 }))

function render(state: Partial<ReturnType<typeof useApp.getState>>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({
      currentVault: 'v',
      currentPath: undefined,
      files: [],
      tags: [],
      query: '',
      vaults: [],
      ...state,
    })
  })
  root = createRoot(host)
  act(() => root!.render(<Sidebar onNavigate={() => {}} />))
  return host
}

const folders = () => [...host!.querySelectorAll('.folder-name')].map((e) => e.textContent)
const notes = () => [...host!.querySelectorAll('.note-title')].map((e) => e.textContent)

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
  document.documentElement.removeAttribute('style')
  vi.restoreAllMocks()
})

const sidebarWidth = () => document.documentElement.style.getPropertyValue('--sidebar-width')

const press = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('Sidebar', () => {
  it('shows the vault as folders, open', () => {
    render({ files: files('dnd/pnj/Ossian.md', 'Inbox.md') })
    expect(folders()).toEqual(['dnd', 'pnj'])
    expect(notes()).toEqual(['Ossian', 'Inbox'])
  })

  it('closes a folder, and remembers it for that vault', () => {
    render({ files: files('dnd/pnj/Ossian.md', 'Inbox.md') })
    act(() => host!.querySelector<HTMLButtonElement>('.folder-row')!.click())
    expect(folders()).toEqual(['dnd'])
    expect(notes()).toEqual(['Inbox'])
    expect(host!.querySelector('.folder-count')?.textContent).toBe('1')

    act(() => root!.unmount())
    render({ files: files('dnd/pnj/Ossian.md', 'Inbox.md') })
    expect(notes()).toEqual(['Inbox'])
  })

  it('opens the folders the open note is in', () => {
    render({ files: files('dnd/pnj/Ossian.md') })
    act(() => host!.querySelector<HTMLButtonElement>('.folder-row')!.click())
    expect(notes()).toEqual([])

    act(() => useApp.setState({ currentPath: 'dnd/pnj/Ossian.md' }))
    expect(notes()).toEqual(['Ossian'])
  })

  it('filters by tag, without asking the server', () => {
    const search = vi.fn()
    const tags: TagSummary[] = [
      { tag: 'pnj', key: 'pnj', paths: ['dnd/pnj/Ossian.md'] },
      { tag: 'objeto', key: 'objeto', paths: ['dnd/Acero.md'] },
    ]
    render({ files: files('dnd/pnj/Ossian.md', 'dnd/Acero.md'), tags, search, query: '#pnj' })

    expect(notes()).toEqual(['Ossian'])
    expect(search).not.toHaveBeenCalled()
    // Every tag matching what was typed is offered, with how many notes carry it.
    expect([...host!.querySelectorAll('.tag-chip')].map((c) => c.textContent)).toEqual(['#pnj1'])
  })

  it('offers the whole tag list for a bare #', () => {
    const tags: TagSummary[] = [
      { tag: 'pnj', key: 'pnj', paths: ['A.md'] },
      { tag: 'objeto', key: 'objeto', paths: ['B.md'] },
    ]
    render({ files: files('A.md', 'B.md'), tags, query: '#' })
    expect(host!.querySelectorAll('.tag-chip')).toHaveLength(2)
    expect(notes()).toEqual([])
    expect(host!.textContent).toContain('Pick a tag')
  })

  it('says so when a tag has nothing under it', () => {
    render({ files: files('A.md'), tags: [], query: '#gone' })
    expect(host!.textContent).toContain('Nothing is tagged #gone')
  })

  it('resizes the note list, and remembers how wide', () => {
    render({ files: files('A.md') })
    const handle = host!.querySelector('.sidebar-resizer')!
    expect(sidebarWidth()).toBe('272px')

    act(() => void press(handle, 'ArrowRight'))
    expect(sidebarWidth()).toBe('288px')

    // A width chosen once is the width the next window opens at.
    act(() => root!.unmount())
    render({ files: files('A.md') })
    expect(sidebarWidth()).toBe('288px')
  })

  it('will not drag the list past half the window, or under a usable width', () => {
    render({ files: files('A.md') })
    const handle = host!.querySelector('.sidebar-resizer')!

    act(() => void press(handle, 'End'))
    expect(sidebarWidth()).toBe(`${Math.min(480, window.innerWidth / 2)}px`)

    act(() => void press(handle, 'Home'))
    expect(sidebarWidth()).toBe('192px')

    // Double-clicking the handle puts it back where it started.
    act(() => handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(sidebarWidth()).toBe('272px')
  })
})
