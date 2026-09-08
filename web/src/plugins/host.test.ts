import { afterEach, describe, expect, it, vi } from 'vitest'
import { allCommands } from '../state/commands'
import { clearSlots } from '../ui/Slot'
import type { QuartzPlugin } from '@quartz/plugin-api'
import { start } from './host'

const stops: Array<() => void> = []

afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop()
  clearSlots()
})

/** Starts a plugin and remembers the teardown, so a test cannot leak one. */
function run(plugin: QuartzPlugin): () => void {
  const stop = start(plugin)
  stops.push(stop)
  return stop
}

const ids = () => allCommands().map((c) => c.id)

const plugin = (over: Partial<QuartzPlugin> & Pick<QuartzPlugin, 'id' | 'setup'>): QuartzPlugin => ({
  name: over.id,
  description: 'a plugin, for a test',
  ...over,
})

describe('starting a plugin', () => {
  it('namespaces what a plugin registers by the plugin id', () => {
    run(plugin({ id: 'alpha', setup: (q) => q.commands.add({ id: 'go', title: 'Alpha go', run: () => {} }) }))
    run(plugin({ id: 'beta', setup: (q) => q.commands.add({ id: 'go', title: 'Beta go', run: () => {} }) }))
    // Two plugins may both call their command `go` and both survive.
    expect(ids()).toEqual(['alpha/go', 'beta/go'])
  })

  it('takes everything back out on teardown', () => {
    const stop = run(
      plugin({
        id: 'alpha',
        setup(q) {
          q.commands.add({ id: 'go', title: 'Go', run: () => {} })
          q.ui.sidebarSection({ id: 'panel', title: 'Panel', render: () => null })
          q.ui.statusItem({ id: 'item', render: () => null })
        },
      }),
    )
    expect(ids()).toEqual(['alpha/go'])
    stop()
    expect(ids()).toEqual([])
  })

  it('runs a plugin’s own teardown too', () => {
    const stopped = vi.fn()
    run(plugin({ id: 'a', setup: () => stopped }))()
    expect(stopped).toHaveBeenCalledOnce()
  })

  /**
   * A plugin that throws on the way up is a bug in that plugin, not a reason
   * for the app to come up without the others — or without its notes.
   */
  it('starts the rest when one plugin throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    run(
      plugin({
        id: 'bad',
        setup() {
          throw new Error('boom')
        },
      }),
    )
    run(plugin({ id: 'good', setup: (q) => q.commands.add({ id: 'go', title: 'Go', run: () => {} }) }))
    expect(ids()).toEqual(['good/go'])
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  it('keeps what a plugin registered before it threw', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = run(
      plugin({
        id: 'half',
        setup(q) {
          q.commands.add({ id: 'go', title: 'Go', run: () => {} })
          throw new Error('boom')
        },
      }),
    )
    expect(ids()).toEqual(['half/go'])
    // And that half still comes out cleanly.
    stop()
    expect(ids()).toEqual([])
    quiet.mockRestore()
  })

  it('does not let a failing teardown strand the rest of its own', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = run(
      plugin({
        id: 'bad',
        setup(q) {
          q.commands.add({ id: 'go', title: 'Go', run: () => {} })
          return () => {
            throw new Error('boom')
          }
        },
      }),
    )
    stop()
    // The plugin's own teardown threw; the command it registered still went.
    expect(ids()).toEqual([])
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  /**
   * The marketplace calls a teardown when a row is switched off, and nothing
   * stops it being switched off twice — a double tap, or a stop during an
   * unmount that already stopped it.
   */
  it('is safe to stop twice', () => {
    const stopped = vi.fn()
    const stop = run(plugin({ id: 'a', setup: () => stopped }))
    stop()
    stop()
    expect(stopped).toHaveBeenCalledOnce()
  })
})
