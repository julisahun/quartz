// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { allCommands } from '../state/commands'
import { clearSlots } from '../ui/Slot'
import type { QuartzPlugin } from '@quartz/plugin-api'
import { installedIds, setInstalled } from './enabled'
import { Marketplace } from './Marketplace'
import { startPlugins } from './manager'

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

function plugin(id: string, name: string, description: string): QuartzPlugin {
  return {
    id,
    name,
    description,
    version: '1.0.0',
    author: 'Quartz',
    setup: (q) => q.commands.add({ id: 'go', title: `${name} go`, run: () => {} }),
  }
}

const catalogue = [
  plugin('word-count', 'Word count', 'How long the open note is, in the status bar.'),
  plugin('daily-note', 'Daily note', 'A note per day in journal/.'),
]

function show(plugins: QuartzPlugin[] = catalogue) {
  stop = startPlugins(plugins, () => () => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Marketplace />))
  return host
}

/** The row a plugin is on, found by the name in it. */
function row(name: string): HTMLElement {
  const found = [...host!.querySelectorAll<HTMLElement>('.px-market-row')].find((el) =>
    el.querySelector('.px-market-name')?.textContent?.startsWith(name),
  )
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

const groupOf = (name: string) =>
  row(name).closest('.px-market-group')?.querySelector('.px-market-group-head')?.textContent

const action = (name: string) => row(name).querySelector('button')!
const names = () =>
  [...host!.querySelectorAll('.px-market-name')].map((el) => el.textContent?.replace('1.0.0', '').trim())

/**
 * Types into the search field.
 *
 * Through the prototype's own setter, not `field.value =`: React tracks the
 * value it last rendered on the node itself, and an assignment it can see
 * makes the change it is told about look like one that already happened.
 */
const search = (text: string) => {
  const field = host!.querySelector<HTMLInputElement>('.px-market-search')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setValue.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the marketplace', () => {
  it('offers everything the build ships, with nothing installed', () => {
    show()
    expect(names()).toEqual(['Word count', 'Daily note'])
    expect(groupOf('Word count')).toContain('Available')
    expect(action('Word count').textContent).toBe('Install')
  })

  it('says so when nothing is turned on', () => {
    show()
    expect(host!.textContent).toContain('Nothing turned on yet')
  })

  it('installs a plugin, and the plugin is running', () => {
    show()
    act(() => action('Word count').click())

    expect(groupOf('Word count')).toContain('Installed')
    expect(action('Word count').textContent).toBe('Remove')
    // The point of the button: the plugin's contributions are live now, with
    // no reload in between.
    expect(allCommands().map((c) => c.id)).toEqual(['word-count/go'])
    expect([...installedIds()]).toEqual(['word-count'])
  })

  it('removes a plugin, and the plugin stops', () => {
    setInstalled('daily-note', true)
    show()
    expect(groupOf('Daily note')).toContain('Installed')

    act(() => action('Daily note').click())
    expect(groupOf('Daily note')).toContain('Available')
    expect(allCommands()).toEqual([])
    expect([...installedIds()]).toEqual([])
  })

  it('opens with what was installed last time already installed', () => {
    setInstalled('daily-note', true)
    show()
    expect(groupOf('Daily note')).toContain('Installed')
    expect(groupOf('Word count')).toContain('Available')
  })

  it('searches the description as well as the name', () => {
    show()
    // Nothing is called "journal"; the daily note is described by it.
    search('journal')
    expect(names()).toEqual(['Daily note'])
  })

  it('says when a search matches nothing', () => {
    show()
    search('graph view')
    expect(names()).toEqual([])
    expect(host!.textContent).toContain('Nothing matches')
  })

  /**
   * With a search running, an empty half is the search's doing. Saying
   * "nothing turned on yet" there would be answering a question nobody asked.
   */
  it('does not call a filtered-out group empty', () => {
    show()
    search('journal')
    expect(host!.textContent).not.toContain('Nothing turned on yet')
  })

  it('names the plugin in the button’s label, since two say the same word', () => {
    show()
    expect(action('Word count').getAttribute('aria-label')).toBe('Install Word count')
  })

  it('is honest about where the code comes from', () => {
    show()
    expect(host!.textContent).toContain('These ship with Quartz')
  })

  it('has something to say for a build with no plugins at all', () => {
    show([])
    expect(host!.textContent).toContain('ships no plugins')
  })
})
