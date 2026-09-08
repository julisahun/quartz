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
      <StatusBar livePreview onToggleLivePreview={() => {}} onOpenSettings={onOpenSettings} />,
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

  it('offers to publish the folder once there is a session', () => {
    render({ signedIn: true, user: 'juli' })
    expect(buttons()).toContain('sync…')
  })

  it('does not offer to publish a folder with no account to publish it to', () => {
    render({})
    expect(buttons()).not.toContain('sync…')
  })

  it('does not read a vault list as a session', () => {
    // The old test for "signed in" was "some vault came from the server", so a
    // cached list outlived the session it was fetched with — and a device with
    // only folders could never have one at all.
    render({
      signedIn: false,
      vaults: [
        { id: 'local-abc', name: 'talasia', kind: 'local' },
        { id: 'juli', name: 'juli', owner: 'juli', role: 'owner' },
      ],
    })
    expect(buttons()).not.toContain('sync…')
  })
})
