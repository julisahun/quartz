// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allCommands } from '../state/commands'
import { clearSlots } from '../ui/Slot'
import type { QuartzPlugin } from '@quartz/plugin-api'
import { installedIds, setInstalled } from './enabled'
import { install, startPlugins, uninstall } from './manager'

let stop: (() => void) | undefined
/** Stands in for the settings-slot registration `index.tsx` passes in. */
let sectionAdded = 0
let sectionRemoved = 0

afterEach(() => {
  stop?.()
  stop = undefined
  sectionAdded = 0
  sectionRemoved = 0
  clearSlots()
  localStorage.clear()
})

const ids = () => allCommands().map((c) => c.id)

function plugin(id: string): QuartzPlugin {
  return {
    id,
    name: id,
    description: `the ${id} plugin`,
    setup: (q) => q.commands.add({ id: 'go', title: `${id} go`, run: () => {} }),
  }
}

function begin(catalogue: QuartzPlugin[]) {
  stop = startPlugins(catalogue, () => {
    sectionAdded += 1
    return () => {
      sectionRemoved += 1
    }
  })
}

describe('the plugin manager', () => {
  it('starts nothing on a device that has chosen nothing', () => {
    begin([plugin('a'), plugin('b')])
    expect(ids()).toEqual([])
  })

  it('starts what was turned on last time, and only that', () => {
    setInstalled('b', true)
    begin([plugin('a'), plugin('b')])
    expect(ids()).toEqual(['b/go'])
  })

  it('offers the marketplace whether or not anything is running', () => {
    begin([plugin('a')])
    expect(sectionAdded).toBe(1)
  })

  it('runs a plugin the moment it is installed', () => {
    begin([plugin('a')])
    install('a')
    expect(ids()).toEqual(['a/go'])
    expect([...installedIds()]).toEqual(['a'])
  })

  it('stops a plugin the moment it is removed', () => {
    setInstalled('a', true)
    begin([plugin('a')])
    expect(ids()).toEqual(['a/go'])
    uninstall('a')
    expect(ids()).toEqual([])
    expect([...installedIds()]).toEqual([])
  })

  it('ignores an id that is not in the catalogue', () => {
    begin([plugin('a')])
    install('nope')
    expect(ids()).toEqual([])
    // And nothing is remembered about a plugin that could not be started.
    expect([...installedIds()]).toEqual([])
  })

  it('does not start a plugin twice', () => {
    begin([plugin('a')])
    install('a')
    install('a')
    expect(ids()).toEqual(['a/go'])
  })

  /**
   * A stored id whose plugin this build does not have cannot be started, but
   * turning it off must still be possible — otherwise the row is stuck on for
   * anyone whose build has since dropped it.
   */
  it('clears the preference for a plugin it cannot run', () => {
    setInstalled('gone', true)
    begin([plugin('a')])
    uninstall('gone')
    expect([...installedIds()]).toEqual([])
  })

  it('ignores removing something that was never on', () => {
    begin([plugin('a')])
    expect(() => uninstall('a')).not.toThrow()
    expect(ids()).toEqual([])
  })

  it('takes the running set and the marketplace back out on teardown', () => {
    setInstalled('a', true)
    begin([plugin('a')])
    stop!()
    stop = undefined
    expect(ids()).toEqual([])
    expect(sectionRemoved).toBe(1)
    // Turning it off was not what happened, so it comes back next launch.
    expect([...installedIds()]).toEqual(['a'])
  })

  it('keeps a plugin that throws on the way up out of nobody’s way', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    setInstalled('bad', true)
    setInstalled('good', true)
    begin([
      {
        id: 'bad',
        name: 'Bad',
        description: 'throws',
        setup() {
          throw new Error('boom')
        },
      },
      plugin('good'),
    ])
    expect(ids()).toEqual(['good/go'])
    quiet.mockRestore()
  })
})
