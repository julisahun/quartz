// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useApp } from '../state/store'
import { StatusBar } from './StatusBar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

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
  act(() => root!.render(<StatusBar livePreview onToggleLivePreview={() => {}} />))
  return host
}

const buttons = () => [...host!.querySelectorAll('button')].map((b) => b.textContent)
const button = (label: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent === label)

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
})

describe('StatusBar, sitting in a folder opened from disk', () => {
  it('offers a way in when there is no session', () => {
    render({})
    // Without this the login screen is unreachable: a folder keeps the app in
    // "ready", and the signed-out banner is keyed on a session this device
    // never had.
    expect(buttons()).toContain('sign in')
    expect(buttons()).not.toContain('sync…')

    act(() => button('sign in')!.click())
    expect(useApp.getState().phase).toBe('login')
  })

  it('offers to publish the folder once there is one', () => {
    render({ signedIn: true, user: 'juli' })
    expect(buttons()).toContain('sync…')
    expect(buttons()).not.toContain('sign in')
  })

  it('does not read a vault list as a session', () => {
    // The old test for "signed in" was "some vault came from the server", so a
    // cached list outlived the session it was fetched with — and a device with
    // only folders could never have one at all.
    render({
      signedIn: false,
      vaults: [
        { id: 'local-abc', name: 'talasia', kind: 'local' },
        { id: 'juli', name: 'juli', kind: 'private', owner: 'juli', role: 'owner' },
      ],
    })
    expect(buttons()).toContain('sign in')
    expect(buttons()).not.toContain('sign out')
  })
})
