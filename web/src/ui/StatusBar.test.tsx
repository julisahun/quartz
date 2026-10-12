// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import { StatusBar } from './StatusBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const onOpenSettings = vi.fn()

/** A device holding one folder opened from disk, and nothing else. */
function render(state: Partial<ReturnType<typeof useApp.getState>>) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({
      phase: 'ready',
      user: '',
      signedIn: false,
      currentVault: 'local-abc',
      currentPath: undefined,
      vaults: [{ id: 'local-abc', name: 'talasia', kind: 'local' }],
      sync: 'local',
      pending: 0,
      unsaved: false,
      ...state,
    })
  })
  root = createRoot(host)
  act(() =>
    root!.render(
      <StatusBar onOpenSettings={onOpenSettings} />,
    ),
  )
  return host
}

const buttons = () => [...host!.querySelectorAll('button')].map((b) => b.textContent)
const labelled = (label: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label)

afterEach(() => {
  onOpenSettings.mockClear()
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('StatusBar, sitting in a folder opened from disk', () => {
  /**
   * The account moved into settings, so this is the only way to it — and a
   * folder keeps the app in "ready" for ever, so on a device that never had a
   * session there is nothing else that leads to the login screen at all.
   */
  it('offers the way into settings, at either width', () => {
    render({})
    expect(labelled('Settings')).toBeTruthy()

    act(() => labelled('Settings')!.click())
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('no longer carries the account itself', () => {
    render({ signedIn: true, user: 'juli' })
    expect(buttons()).not.toContain('password…')
    expect(buttons()).not.toContain('sign out')
  })

  /**
   * The note's and the vault's actions moved next to what they act on — the
   * note header and the vault's ⋯ — so this strip only says how things are.
   */
  it('acts on neither the note nor the vault', () => {
    render({ signedIn: true, user: 'juli', currentPath: 'Inbox.md' })
    for (const gone of ['rename', 'delete', 'sync…', 'forget vault', 'preview', 'source']) {
      expect(buttons()).not.toContain(gone)
    }
  })

  it('says what state the folder is in', () => {
    render({})
    expect(host!.textContent).toContain('Local folder')
  })
})
