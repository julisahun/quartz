// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { addHomeSource, homeOf, resolveHome, setHome, type HomeSource } from './home'

const withdrawals: Array<() => void> = []

function offer(
  id: string,
  resolve: HomeSource['resolve'] = async () => `${id}.md`,
  group?: string,
): () => void {
  const withdraw = addHomeSource({ id, label: id, resolve, group })
  withdrawals.push(withdraw)
  return withdraw
}

afterEach(() => {
  for (const withdraw of withdrawals.splice(0)) withdraw()
  localStorage.clear()
})

describe('a vault’s home', () => {
  it('is nothing until something sets it', () => {
    expect(homeOf('v')).toBeUndefined()
  })

  it('is a note somebody picked', () => {
    setHome('v', { kind: 'note', path: 'index.md' })
    expect(homeOf('v')).toEqual({ kind: 'note', path: 'index.md' })
  })

  it('belongs to one vault', () => {
    setHome('v', { kind: 'note', path: 'index.md' })
    expect(homeOf('w')).toBeUndefined()
  })
})

describe('the last one set wins', () => {
  it('goes to a source the first time a vault meets it', () => {
    setHome('v', { kind: 'note', path: 'index.md' })
    offer('today')
    expect(homeOf('v')).toEqual({ kind: 'source', id: 'today', label: 'today' })
  })

  it('stays with a note picked after the source arrived', () => {
    offer('today')
    homeOf('v')
    setHome('v', { kind: 'note', path: 'index.md' })
    // The next launch registers the source again; that is not a new choice.
    expect(homeOf('v')).toEqual({ kind: 'note', path: 'index.md' })
  })

  it('stays with a note picked before the vault was ever looked at', () => {
    offer('today')
    setHome('v', { kind: 'note', path: 'index.md' })
    expect(homeOf('v')).toEqual({ kind: 'note', path: 'index.md' })
  })

  it('goes to the newest of two arriving together', () => {
    offer('a')
    offer('b')
    expect(homeOf('v')).toMatchObject({ kind: 'source', id: 'b' })
  })
})

describe('several homes from one place', () => {
  it('takes over with the first, and offers the rest', () => {
    offer('p/today', undefined, 'p')
    offer('p/calendar', undefined, 'p')
    expect(homeOf('v')).toMatchObject({ kind: 'source', id: 'p/today' })
  })

  it('does not take over again when a second home is added later', () => {
    offer('p/today', undefined, 'p')
    homeOf('v')
    offer('p/calendar', undefined, 'p')
    expect(homeOf('v')).toMatchObject({ kind: 'source', id: 'p/today' })
  })

  it('keeps a picked alternative across launches', () => {
    offer('p/today', undefined, 'p')
    offer('p/calendar', undefined, 'p')
    homeOf('v')
    setHome('v', { kind: 'source', id: 'p/calendar', label: 'Calendar' })
    expect(homeOf('v')).toMatchObject({ id: 'p/calendar' })
  })

  it('resolves a view', async () => {
    offer('p/calendar', async () => ({ view: 'p/calendar' }), 'p')
    expect(await resolveHome(homeOf('v')!)).toEqual({ view: 'p/calendar' })
  })
})

describe('withdrawing a source', () => {
  it('clears it as a home', () => {
    const withdraw = offer('today')
    homeOf('v')
    withdraw()
    expect(homeOf('v')).toBeUndefined()
  })

  it('lets it take over again when it comes back', () => {
    const withdraw = offer('today')
    homeOf('v')
    setHome('v', { kind: 'note', path: 'index.md' })
    withdraw()
    // Turned back on: that is asking for it, so it is the home again.
    offer('today')
    expect(homeOf('v')).toMatchObject({ kind: 'source', id: 'today' })
  })

  it('leaves a picked note alone', () => {
    const withdraw = offer('today')
    homeOf('v')
    setHome('v', { kind: 'note', path: 'index.md' })
    withdraw()
    expect(homeOf('v')).toEqual({ kind: 'note', path: 'index.md' })
  })
})

describe('resolving', () => {
  it('asks the source for today’s answer', async () => {
    offer('today', async () => 'journal/2026-10-12.md')
    expect(await resolveHome(homeOf('v')!)).toEqual({ path: 'journal/2026-10-12.md' })
  })

  it('says so when the source is not there to ask', async () => {
    expect(await resolveHome({ kind: 'source', id: 'gone', label: "Today's note" })).toEqual({
      problem: "Today's note is not available here",
    })
  })

  it('reports a source that throws instead of passing it on', async () => {
    offer('broken', async () => {
      throw new Error('boom')
    })
    const found = await resolveHome(homeOf('v')!)
    expect(found).toMatchObject({ problem: expect.stringContaining('boom') })
  })
})
