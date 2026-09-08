import { afterEach, describe, expect, it, vi } from 'vitest'
import { allCommands } from '../state/commands'
import { clearSlots } from '../ui/Slot'
import type { QuartzPlugin } from './api'
import { mount } from './host'

let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  clearSlots()
})

const ids = () => allCommands().map((c) => c.id)

describe('mounting plugins', () => {
  it('namespaces what a plugin registers by the plugin id', () => {
    unmount = mount([
      { id: 'alpha', name: 'Alpha', setup: (q) => q.commands.add({ id: 'go', title: 'Alpha go', run: () => {} }) },
      { id: 'beta', name: 'Beta', setup: (q) => q.commands.add({ id: 'go', title: 'Beta go', run: () => {} }) },
    ])
    // Two plugins may both call their command `go` and both survive.
    expect(ids()).toEqual(['alpha/go', 'beta/go'])
  })

  it('takes everything back out on teardown', () => {
    const stop = mount([
      {
        id: 'alpha',
        name: 'Alpha',
        setup(q) {
          q.commands.add({ id: 'go', title: 'Go', run: () => {} })
          q.ui.sidebarSection({ id: 'panel', title: 'Panel', render: () => null })
          q.ui.statusItem({ id: 'item', render: () => null })
        },
      },
    ])
    expect(ids()).toEqual(['alpha/go'])
    stop()
    expect(ids()).toEqual([])
  })

  it('runs a plugin’s own teardown too', () => {
    const stopped = vi.fn()
    mount([{ id: 'a', name: 'A', setup: () => stopped }])()
    expect(stopped).toHaveBeenCalledOnce()
  })

  /**
   * A plugin that throws on the way up is a bug in that plugin, not a reason
   * for the app to come up without the others — or without its notes.
   */
  it('starts the rest when one plugin throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad: QuartzPlugin = {
      id: 'bad',
      name: 'Bad',
      setup() {
        throw new Error('boom')
      },
    }
    const good: QuartzPlugin = {
      id: 'good',
      name: 'Good',
      setup: (q) => q.commands.add({ id: 'go', title: 'Go', run: () => {} }),
    }
    unmount = mount([bad, good])
    expect(ids()).toEqual(['good/go'])
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('keeps what a plugin registered before it threw', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    unmount = mount([
      {
        id: 'half',
        name: 'Half',
        setup(q) {
          q.commands.add({ id: 'go', title: 'Go', run: () => {} })
          throw new Error('boom')
        },
      },
    ])
    expect(ids()).toEqual(['half/go'])
    // And that half still comes out cleanly.
    unmount()
    unmount = undefined
    expect(ids()).toEqual([])
    quiet.mockRestore()
  })

  it('does not let one failing teardown strand the others', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = mount([
      {
        id: 'bad',
        name: 'Bad',
        setup: () => () => {
          throw new Error('boom')
        },
      },
      { id: 'good', name: 'Good', setup: (q) => q.commands.add({ id: 'go', title: 'Go', run: () => {} }) },
    ])
    stop()
    expect(ids()).toEqual([])
    quiet.mockRestore()
  })
})
