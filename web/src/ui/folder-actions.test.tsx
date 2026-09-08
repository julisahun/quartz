// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import type { FileMeta } from '../vault/types'
import { folderMenu, promptRenameFolder } from './actions'
import { Dialogs } from './dialogs'
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
      files: files('dnd/Ossian.md', 'dnd/talasia/Places.md', 'Inbox.md'),
      tags: [],
      query: '',
      vaults: [],
      notices: [],
      ...state,
    })
  })
  root = createRoot(host)
  act(() =>
    root!.render(
      <>
        <Sidebar onNavigate={() => {}} />
        <Dialogs />
      </>,
    ),
  )
  return host
}

const labelled = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label)
const menuItems = () => [...document.querySelectorAll('.menu-item')].map((b) => b.textContent)
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.menu-item')].find((b) =>
    b.textContent?.startsWith(text),
  )
const field = () => document.querySelector<HTMLInputElement>('.sheet-body input')
const sheetTitle = () => document.querySelector('.sheet-head h2')?.textContent
const fieldLabel = () => document.querySelector('.field span')?.textContent

/** Types into the sheet's field, through the setter React tracks. */
function type(text: string) {
  const input = field()!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function submit() {
  act(() => {
    document
      .querySelector('.sheet-body')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}

afterEach(() => {
  // A test that leaves a sheet open leaves a promise pending in the dialog
  // store, which is module-level and outlives the render — so it would open
  // again over the next test. Escape is what a person would do.
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('the folder row', () => {
  it('offers its actions without having to be opened', () => {
    render()
    // The row itself toggles; the actions are a button of their own, so a
    // closed folder is not a folder you cannot act on.
    expect(labelled('Actions for dnd')).toBeTruthy()
    expect(labelled('Actions for talasia')).toBeTruthy()
  })

  it('opens a menu naming the folder', async () => {
    render()
    await act(async () => {
      labelled('Actions for dnd')!.click()
    })
    expect(sheetTitle()).toBe('dnd')
    expect(menuItems()).toEqual([
      expect.stringContaining('Rename…'),
      expect.stringContaining('New folder inside…'),
      expect.stringContaining('Delete'),
    ])
  })

  it('marks deleting as the dangerous one', async () => {
    render()
    await act(async () => {
      labelled('Actions for dnd')!.click()
    })
    expect(menuItem('Delete')!.className).toContain('danger')
  })
})

describe('renaming a folder from the sheet', () => {
  it('asks for a name, not a path', async () => {
    render()
    void promptRenameFolder('dnd/talasia')
    await act(async () => {})
    // The folder's own name, so it cannot be moved elsewhere by typing.
    expect(field()!.value).toBe('talasia')
    expect(sheetTitle()).toBe('Rename talasia')
  })

  it('renames the folder', async () => {
    const renameFolder = vi.fn().mockResolvedValue({ path: 'campaign', moved: 2, rewritten: 0 })
    render({ renameFolder })

    void promptRenameFolder('dnd')
    await act(async () => {})
    type('campaign')
    submit()
    await act(async () => {})

    expect(renameFolder).toHaveBeenCalledWith('dnd', 'campaign')
  })

  it('says what happened when links were brought up to date', async () => {
    const renameFolder = vi.fn().mockResolvedValue({ path: 'campaign', moved: 2, rewritten: 3 })
    const notify = vi.fn()
    render({ renameFolder, notify })

    void promptRenameFolder('dnd')
    await act(async () => {})
    type('campaign')
    submit()
    await act(async () => {})

    expect(notify).toHaveBeenCalledWith('info', 'dnd is now campaign; 3 notes updated')
  })

  it('says nothing when no link had to move', async () => {
    const renameFolder = vi.fn().mockResolvedValue({ path: 'campaign', moved: 2, rewritten: 0 })
    const notify = vi.fn()
    render({ renameFolder, notify })

    void promptRenameFolder('dnd')
    await act(async () => {})
    type('campaign')
    submit()
    await act(async () => {})

    expect(notify).not.toHaveBeenCalled()
  })

  /**
   * A name that cannot work is a small correction, not a reason to start over,
   * so the sheet stays up with the problem where the label was and the typing
   * still in the field.
   */
  it('keeps asking when the name cannot work', async () => {
    const renameFolder = vi.fn()
    render({ renameFolder })

    void promptRenameFolder('dnd')
    await act(async () => {})
    type('one/two')
    submit()
    await act(async () => {})

    expect(renameFolder).not.toHaveBeenCalled()
    expect(field()).toBeTruthy()
    expect(fieldLabel()).toContain('cannot contain')
    expect(field()!.value).toBe('one/two')
  })

  it('does nothing when the name is unchanged', async () => {
    const renameFolder = vi.fn()
    render({ renameFolder })

    void promptRenameFolder('dnd')
    await act(async () => {})
    submit()
    await act(async () => {})

    expect(renameFolder).not.toHaveBeenCalled()
    expect(field()).toBeFalsy()
  })

  it('closes without renaming when the sheet is dismissed', async () => {
    const renameFolder = vi.fn()
    render({ renameFolder })

    void promptRenameFolder('dnd')
    await act(async () => {})
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await act(async () => {})

    expect(renameFolder).not.toHaveBeenCalled()
  })
})

describe('the folder menu', () => {
  it('runs the rename it offers', async () => {
    render()
    void folderMenu('dnd')
    await act(async () => {})
    await act(async () => {
      menuItem('Rename…')!.click()
    })
    expect(sheetTitle()).toBe('Rename dnd')
  })

  it('puts the count of what goes in the delete question', async () => {
    const folderContents = vi.fn().mockReturnValue({ files: 5, notes: 3 })
    render({ folderContents })

    void folderMenu('dnd')
    await act(async () => {})
    await act(async () => {
      menuItem('Delete')!.click()
    })

    // Notes and the pasted screenshots counted apart, because both go.
    expect(document.querySelector('.sheet-body')?.textContent).toContain('3 notes and 2 other files')
  })
})
