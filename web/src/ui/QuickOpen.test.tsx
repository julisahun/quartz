// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addCommand } from '../state/commands'
import { useApp } from '../state/store'
import type { FileMeta } from '../vault/types'
import { QuickOpen } from './QuickOpen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const files: FileMeta[] = [
  { path: 'campaigns/marea-baja/objects/acero-del-manantial.md', hash: 'h', size: 0, mtime: 2 },
  { path: 'campaigns/marea-baja/pnj/ossian.md', hash: 'h', size: 0, mtime: 3 },
  { path: 'Inbox.md', hash: 'h', size: 0, mtime: 1 },
]

function render(onClose = () => {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => useApp.setState({ files }))
  root = createRoot(host)
  act(() => root!.render(<QuickOpen open onClose={onClose} onOpened={() => {}} />))
  return host
}

const field = () => host!.querySelector<HTMLInputElement>('.quick-field')!
const rows = () => [...host!.querySelectorAll('.quick-title')].map((e) => e.textContent)

function type(text: string) {
  // React watches the value property with its own setter, so assigning to it
  // directly leaves the change invisible: go through the native one.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(field(), text)
    field().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(key: string) {
  act(() => field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

const undo: Array<() => void> = []

function command(id: string, title: string, extra: { when?: () => boolean; run?: () => void } = {}) {
  undo.push(addCommand({ id, title, run: extra.run ?? (() => {}), when: extra.when }))
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  for (const remove of undo.splice(0).reverse()) remove()
  vi.restoreAllMocks()
})

describe('QuickOpen', () => {
  it('starts on the most recent notes', () => {
    render()
    expect(rows()).toEqual(['ossian', 'acero-del-manantial', 'Inbox'])
  })

  it('narrows as you type, across the whole path', () => {
    render()
    type('mbacero')
    expect(rows()).toEqual(['acero-del-manantial'])
    expect(host!.querySelector('.quick-folder')?.textContent).toBe(
      'campaigns/marea-baja/objects',
    )
  })

  it('walks the list with the arrows and opens with enter', () => {
    const open = vi.fn()
    act(() => useApp.setState({ open }))
    render()

    press('ArrowDown')
    press('Enter')
    expect(open).toHaveBeenCalledWith('campaigns/marea-baja/objects/acero-del-manantial.md')
  })

  it('escapes without opening anything', () => {
    const open = vi.fn()
    const onClose = vi.fn()
    act(() => useApp.setState({ open }))
    render(onClose)

    press('Escape')
    expect(onClose).toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('says when nothing matches', () => {
    render()
    type('zzzz')
    expect(host!.textContent).toContain('No note matches')
  })
})

/**
 * `>` is the switch every editor with one of these uses. It costs nothing:
 * no note is called `>anything`.
 */
describe('QuickOpen in command mode', () => {
  it('lists the commands behind a bare >', () => {
    command('a', 'Sync now')
    command('b', 'New note…')
    render()
    type('>')
    expect(rows()).toEqual(['Sync now', 'New note…'])
  })

  it('narrows commands by title', () => {
    command('a', 'Sync now')
    command('b', 'New note…')
    render()
    type('>sync')
    expect(rows()).toEqual(['Sync now'])
  })

  it('leaves out a command that does not apply right now', () => {
    command('a', 'Rename this note…', { when: () => false })
    command('b', 'Sync now')
    render()
    type('>')
    expect(rows()).toEqual(['Sync now'])
  })

  it('runs the highlighted command on enter, and closes', () => {
    const run = vi.fn()
    const onClose = vi.fn()
    command('a', 'Sync now', { run })
    render(onClose)

    type('>sync')
    press('Enter')
    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalled()
  })

  it('does not open a note while in command mode', () => {
    const open = vi.fn()
    act(() => useApp.setState({ open }))
    command('a', 'Sync now')
    render()

    type('>')
    press('Enter')
    expect(open).not.toHaveBeenCalled()
  })

  it('says when no command matches', () => {
    command('a', 'Sync now')
    render()
    type('>zzzz')
    expect(host!.textContent).toContain('No command matches')
  })

  it('goes back to notes when the > is deleted', () => {
    command('a', 'Sync now')
    render()
    type('>')
    type('')
    expect(rows()).toEqual(['ossian', 'acero-del-manantial', 'Inbox'])
  })
})
