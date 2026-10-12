// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHistory } from '../api/client'
import { useApp } from '../state/store'
import type { FileMeta } from '../vault/types'
import { ago, originalOf, promptDelete, promptMove, promptRename } from './actions'
import { Dialogs } from './dialogs'
import { Notices } from './Notices'
import { Sidebar } from './Sidebar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const files = (...paths: string[]): FileMeta[] =>
  paths.map((path) => ({ path, hash: 'h', size: 0, mtime: 0 }))

function render(state: Partial<ReturnType<typeof useApp.getState>> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({
      currentVault: 'v',
      currentPath: undefined,
      files: files('dnd/Ossian.md', 'dnd/talasia/Places.md', 'Inbox.md', 'dnd/map.pdf'),
      tags: [],
      query: '',
      vaults: [],
      notices: [],
      linksTo: async () => 0,
      ...state,
    })
  })
  root = createRoot(host)
  act(() =>
    root!.render(
      <>
        <Sidebar onNavigate={() => {}} />
        <Notices />
        <Dialogs />
      </>,
    ),
  )
  return host
}

const menuItems = () => [...document.querySelectorAll('.menu-item')].map((b) => b.firstChild?.textContent)
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.menu-item')].find((b) => b.firstChild?.textContent === text)
const field = () => document.querySelector<HTMLInputElement>('.sheet-body input')
const fieldLabel = () => document.querySelector('.field span')?.textContent

function type(text: string) {
  const input = field()!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => {
    document
      .querySelector('.sheet-body')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

async function confirm() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('.sheet-actions .button.danger, .sheet-actions .button.primary')!.click()
  })
}

afterEach(() => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('renaming a note', () => {
  it('asks for a name, and keeps the folder and the extension', async () => {
    const renameNote = vi.fn(async (_from: string, to: string) => to)
    render({ renameNote })
    let done: Promise<unknown> = Promise.resolve()
    act(() => {
      done = promptRename('dnd/Ossian.md')
    })
    expect(field()!.value).toBe('Ossian')
    type('Ossian the bard')
    await submit()
    await act(() => done)
    expect(renameNote).toHaveBeenCalledWith('dnd/Ossian.md', 'dnd/Ossian the bard.md', false)
  })

  it('keeps a file’s own extension, even when it is typed again', async () => {
    const renameNote = vi.fn(async (_from: string, to: string) => to)
    render({ renameNote })
    let done: Promise<unknown> = Promise.resolve()
    act(() => {
      done = promptRename('dnd/map.pdf')
    })
    expect(field()!.value).toBe('map')
    type('world map.pdf')
    await submit()
    await act(() => done)
    expect(renameNote).toHaveBeenCalledWith('dnd/map.pdf', 'dnd/world map.pdf', false)
  })

  it('will not move the note by way of a slash', async () => {
    const renameNote = vi.fn()
    render({ renameNote })
    act(() => {
      void promptRename('Inbox.md')
    })
    type('dnd/Inbox')
    await submit()
    expect(fieldLabel()).toContain('Move to…')
    expect(renameNote).not.toHaveBeenCalled()
  })
})

describe('moving a note', () => {
  it('offers the other folders, and the root', async () => {
    render()
    act(() => {
      void promptMove('dnd/Ossian.md')
    })
    expect(menuItems()).toEqual(['Vault root', 'talasia'])
  })

  it('moves it to the folder picked', async () => {
    const renameNote = vi.fn(async (_from: string, to: string) => to)
    render({ renameNote })
    let done: Promise<unknown> = Promise.resolve()
    act(() => {
      done = promptMove('Inbox.md')
    })
    await act(async () => menuItem('talasia')!.click())
    await act(() => done)
    expect(renameNote).toHaveBeenCalledWith('Inbox.md', 'dnd/talasia/Inbox.md', false)
  })
})

describe('deleting a note', () => {
  it('offers to undo, and undoing puts the bytes back', async () => {
    const held = [{ path: 'Inbox.md', data: new Uint8Array([104, 105]) }]
    const restoreFiles = vi.fn(async () => {})
    const deleteNote = vi.fn(async () => {})
    render({ holdFiles: async () => held, deleteNote, restoreFiles })
    let done: Promise<unknown> = Promise.resolve()
    act(() => {
      done = promptDelete('Inbox.md')
    })
    await confirm()
    await act(() => done)
    expect(deleteNote).toHaveBeenCalledWith('Inbox.md')

    const undo = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Undo')!
    await act(async () => undo.click())
    expect(restoreFiles).toHaveBeenCalledWith(held)
    expect(useApp.getState().notices).toHaveLength(0)
  })
})

describe('a row', () => {
  it('opens its actions on a right-click', async () => {
    render()
    const row = [...document.querySelectorAll<HTMLElement>('.note-row')].find((r) => r.textContent?.includes('Inbox'))!
    await act(async () => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(menuItems()).toEqual(['Open', 'Rename…', 'Move to…', 'Delete'])
  })

  it('is walked with the arrow keys', () => {
    render()
    const rows = () => [...document.querySelectorAll<HTMLElement>('.folder-row, .note-row')]
    act(() => rows()[0].focus())
    act(() => {
      rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(rows()[1])
    // Left on an open folder closes it.
    act(() => rows()[0].focus())
    act(() => {
      rows()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    })
    expect(rows()[0].getAttribute('aria-expanded')).toBe('false')
  })
})

describe('notices', () => {
  it('lets a passing one go by itself, and keeps an error', () => {
    vi.useFakeTimers()
    render()
    act(() => {
      useApp.getState().notify('info', 'moved')
      useApp.getState().notify('error', 'broken')
    })
    act(() => vi.advanceTimersByTime(7_000))
    expect(useApp.getState().notices.map((n) => n.text)).toEqual(['broken'])
  })
})

describe('helpers', () => {
  it('finds the note a conflict copy came from', () => {
    expect(originalOf('dnd/Plan (conflict laptop 2026-10-12).md')).toBe('dnd/Plan.md')
  })

  it('says how long ago, coarsely', () => {
    const now = Date.UTC(2026, 9, 12, 12)
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(ago(now - 5_000, now)).toBe('just now')
  })

  it('reads the server’s log lines', () => {
    expect(
      parseHistory(['ab12cd3 2026-10-12T10:00:00+02:00 quartz: sync 2026-10-12T08:00:00Z', 'garbage']),
    ).toEqual([{ rev: 'ab12cd3', at: Date.parse('2026-10-12T10:00:00+02:00') }])
  })
})
