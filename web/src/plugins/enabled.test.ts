// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installedIds, setInstalled } from './enabled'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('what is turned on', () => {
  it('starts with nothing', () => {
    // The whole point of a marketplace: shipping a plugin offers it, and an
    // app that grows behaviour on update is one nobody chose.
    expect([...installedIds()]).toEqual([])
  })

  it('remembers what was turned on', () => {
    setInstalled('word-count', true)
    setInstalled('daily-note', true)
    expect([...installedIds()].sort()).toEqual(['daily-note', 'word-count'])
  })

  it('forgets what was turned off', () => {
    setInstalled('word-count', true)
    setInstalled('word-count', false)
    expect([...installedIds()]).toEqual([])
  })

  it('is not confused by turning the same thing on twice', () => {
    setInstalled('word-count', true)
    setInstalled('word-count', true)
    expect([...installedIds()]).toEqual(['word-count'])
  })

  /**
   * A build that does not have a plugin must not be the reason a choice about
   * it is lost: downgrade, launch, upgrade, and it should still be on.
   */
  it('keeps ids it does not recognise', () => {
    localStorage.setItem('quartz.plugins', JSON.stringify(['from-a-later-build']))
    setInstalled('word-count', true)
    expect([...installedIds()].sort()).toEqual(['from-a-later-build', 'word-count'])
  })

  it('reads junk as nothing turned on', () => {
    localStorage.setItem('quartz.plugins', 'not json')
    expect([...installedIds()]).toEqual([])
    localStorage.setItem('quartz.plugins', JSON.stringify({ 'word-count': true }))
    expect([...installedIds()]).toEqual([])
    localStorage.setItem('quartz.plugins', JSON.stringify(['ok', 7, null]))
    expect([...installedIds()]).toEqual(['ok'])
  })

  it('survives storage it cannot write to', () => {
    // A private window, or site data blocked. The plugin still starts for this
    // session; it just will not be on again next launch.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => setInstalled('word-count', true)).not.toThrow()
  })

  it('survives storage it cannot read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect([...installedIds()]).toEqual([])
  })
})
