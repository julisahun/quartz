// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsView } from '../ui/SettingsView'
import { clearSlots } from '../ui/Slot'
import { useApp } from '../state/store'
import { bundled, startPlugins } from '.'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined
let stop: (() => void) | undefined

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  stop?.()
  stop = undefined
  clearSlots()
  localStorage.clear()
})

/** The settings screen, with the plugin layer started the way the app does. */
function show() {
  stop = startPlugins()
  act(() => {
    useApp.setState({ phase: 'ready', user: '', signedIn: false })
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<SettingsView onBack={() => {}} />))
  return host
}

/**
 * The seam between the two halves: the settings screen renders a slot, and the
 * plugin layer is what puts the marketplace in it. Neither side is tested with
 * the other anywhere else — `SettingsView` is tested against a stub entry, and
 * the marketplace against the manager directly.
 */
describe('the plugin layer, as the app starts it', () => {
  it('puts the marketplace in the settings screen', () => {
    show()
    expect(host!.textContent).toContain('Plugins')
    for (const plugin of bundled) expect(host!.textContent).toContain(plugin.name)
  })

  it('offers every bundled plugin, and starts none of them', () => {
    show()
    // The decision this whole screen exists to make good on: what ships is
    // available, not running.
    expect(host!.querySelectorAll('.px-market-row')).toHaveLength(bundled.length)
    expect([...host!.querySelectorAll('.px-market-action')].map((el) => el.textContent)).toEqual(
      bundled.map(() => 'Install'),
    )
  })

  it('takes the marketplace back out on teardown', () => {
    show()
    act(() => stop!())
    stop = undefined
    expect(host!.textContent).not.toContain('These ship with Quartz')
  })

  it('gives every bundled plugin the fields a marketplace row needs', () => {
    for (const plugin of bundled) {
      expect(plugin.description, plugin.id).toBeTruthy()
      expect(plugin.author, plugin.id).toBeTruthy()
      expect(plugin.version, plugin.id).toBeTruthy()
    }
  })

  it('gives every bundled plugin a unique id', () => {
    // Ids namespace what a plugin registers, so a duplicate would have two
    // plugins quietly overwriting each other's commands and slots.
    expect(new Set(bundled.map((p) => p.id)).size).toBe(bundled.length)
  })
})
