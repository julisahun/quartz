// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import { addToSlot, clearSlots } from './Slot'
import { SettingsView } from './SettingsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

function show(state: Partial<ReturnType<typeof useApp.getState>> = {}, onBack = () => {}) {
  act(() => {
    useApp.setState({ phase: 'ready', user: '', signedIn: false, ...state })
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SettingsView onBack={onBack} />))
  return host
}

const button = (label: string) =>
  [...host!.querySelectorAll('button')].find((b) => b.textContent === label)

beforeEach(() => {
  localStorage.clear()
  // A name, so the device row is not generating one mid-test.
  localStorage.setItem('quartz.device', 'mac-1a2b')
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  clearSlots()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('the settings screen', () => {
  it('says that none of it syncs', () => {
    // Everything here is localStorage, so a phone and a laptop disagree. Left
    // unsaid, that reads as a bug rather than as the design.
    show()
    expect(host!.textContent).toContain('belong to this device')
  })

  it('offers the account when there is one', () => {
    show({ signedIn: true, user: 'juli' })
    expect(host!.textContent).toContain('juli')
    expect(button('Change password…')).toBeTruthy()
    expect(button('Sign out')).toBeTruthy()
  })

  /**
   * The reachability the status bar used to carry: a folder opened from disk
   * keeps the app in `ready` for ever, so without a way in from here the login
   * screen is unreachable on a device that has never had a session.
   */
  it('is the way to the login screen on a device with no account', () => {
    show({ signedIn: false, user: '' })
    expect(button('Change password…')).toBeFalsy()

    act(() => button('Sign in…')!.click())
    expect(useApp.getState().phase).toBe('login')
  })

  it('offers a way back in after a session expires', () => {
    show({ signedIn: false, user: 'juli' })
    expect(host!.textContent).toContain('Signed out of juli')
    expect(button('Sign in…')).toBeTruthy()
  })

  it('shows this device’s name, and why it matters', () => {
    show()
    expect(host!.textContent).toContain('mac-1a2b')
    // It is not only bookkeeping: it is in the middle of every conflict copy's
    // filename, which is read by a person choosing between two versions.
    expect(host!.textContent).toContain('conflict copy')
    expect(button('Rename…')).toBeTruthy()
  })

  it('renders whatever else registered a section', () => {
    // How the marketplace gets here. This screen does not know what plugins
    // are, and must not have to.
    addToSlot('settings.sections', { id: 'x', render: () => <p>a section from elsewhere</p> })
    show()
    expect(host!.textContent).toContain('a section from elsewhere')
  })

  it('goes back', () => {
    const onBack = vi.fn()
    show({}, onBack)
    act(() => [...host!.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Back')!.click())
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('does not offer a server to point at in the browser build', () => {
    // Only the desktop shell has one to choose; the PWA is served by the
    // server it syncs with, so its API is same-origin.
    show()
    expect(host!.textContent).not.toContain('Server')
  })
})
