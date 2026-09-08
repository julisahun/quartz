import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQuartz, type FakeQuartz } from '@quartz/plugin-api'
import { dailyNote } from '.'

let q: FakeQuartz

/** A fixed local noon, so the day never depends on when the suite runs. */
function freezeAt(iso: string) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  q = fakeQuartz()
  dailyNote.setup(q)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the daily note', () => {
  it('registers both days', () => {
    expect(q.commands_.map((c) => c.id)).toEqual(['today', 'yesterday'])
  })

  it('creates today’s note in journal/, with frontmatter and a heading', async () => {
    freezeAt('2026-09-08T12:00:00')
    await q.run('today')

    // The heading is written in whatever locale the device is set to, so it
    // is asserted the same way rather than in English.
    const heading = new Date('2026-09-08T12:00:00').toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    const text = q.files.get('journal/2026-09-08.md')
    expect(text).toBe(`---\ndate: 2026-09-08\n---\n\n# ${heading}\n\n`)
    expect(q.current).toBe('journal/2026-09-08.md')
  })

  it('opens a note that is already there and does not touch it', async () => {
    freezeAt('2026-09-08T12:00:00')
    q.files.set('journal/2026-09-08.md', '# Today\n\nAlready written in.\n')

    await q.run('today')

    expect(q.files.get('journal/2026-09-08.md')).toBe('# Today\n\nAlready written in.\n')
    expect(q.opened).toEqual(['journal/2026-09-08.md'])
  })

  it('goes back a day for yesterday', async () => {
    freezeAt('2026-09-01T12:00:00')
    await q.run('yesterday')
    expect(q.current).toBe('journal/2026-08-31.md')
  })

  /**
   * The local day, not UTC. Late on the 8th in Madrid it is already the 9th in
   * UTC, and a note called "today" that lands on tomorrow is the bug people
   * actually hit with these.
   */
  it('uses the local day late at night', async () => {
    freezeAt('2026-09-08T23:30:00')
    await q.run('today')
    expect(q.current).toBe('journal/2026-09-08.md')
  })

  it('says so when the path it wanted was taken', async () => {
    freezeAt('2026-09-08T12:00:00')
    // A `create` that has to pick another path — the fake stands in for the
    // store's uniquePath by being told to answer differently.
    q.vault.create = async () => {
      await q.vault.open('journal/2026-09-08 2.md')
      return 'journal/2026-09-08 2.md'
    }

    await q.run('today')

    expect(q.notices).toEqual([{ kind: 'info', text: "Today's note went to journal/2026-09-08 2.md" }])
  })
})
