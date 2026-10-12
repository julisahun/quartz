import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQuartz, type FakeQuartz } from '@quartz/plugin-api'
import { dailyNote, monthCells, weekOf } from '.'
import { firstLine, stripTemplate } from './markdown'

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
  it('registers both days, and the calendar', () => {
    expect(q.commands_.map((c) => c.id)).toEqual(['today', 'yesterday', 'calendar'])
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

    expect(q.notices).toEqual([{ kind: 'info', text: 'The note for 2026-09-08 went to journal/2026-09-08 2.md' }])
  })
})

describe('the homes it offers', () => {
  it('offers today first, and the calendar as the alternative', () => {
    expect(q.homes.map((home) => [home.id, home.label])).toEqual([
      ['today', "Today's note"],
      ['calendar', 'Calendar'],
    ])
  })

  it('names today’s note, writing it from the template the first time', async () => {
    freezeAt('2026-09-08T12:00:00')
    expect(await q.homes[0].resolve()).toBe('journal/2026-09-08.md')
    expect(q.files.get('journal/2026-09-08.md')).toMatch(/^---\ndate: 2026-09-08\n---\n/)
  })

  it('leaves a written day alone', async () => {
    freezeAt('2026-09-08T12:00:00')
    q.files.set('journal/2026-09-08.md', 'Already written in.\n')
    expect(await q.homes[0].resolve()).toBe('journal/2026-09-08.md')
    expect(q.files.get('journal/2026-09-08.md')).toBe('Already written in.\n')
  })

  it('answers the calendar view for the other', async () => {
    expect(await q.homes[1].resolve()).toEqual({ view: 'calendar' })
  })
})

describe('the calendar', () => {
  it('is a view, opened from a button in the sidebar header', () => {
    expect(q.views.map((v) => [v.id, v.title])).toEqual([['calendar', 'Calendar']])
    expect(q.buttons).toEqual([{ id: 'calendar', label: 'Calendar', view: 'calendar' }])
  })

  it('opens from ⌘P too', async () => {
    await q.run('calendar')
    expect(q.openedViews).toEqual(['calendar'])
  })

  it('takes journal/ out of the tree, and nothing else', () => {
    expect(q.hidden('journal/2026-10-12.md')).toBe(true)
    expect(q.hidden('journal/ideas.md')).toBe(true)
    expect(q.hidden('journal.md')).toBe(false)
    expect(q.hidden('notes/journal/x.md')).toBe(false)
  })

  it('lays a month out Monday first', () => {
    // September 2026 starts on a Tuesday: one gap, then thirty days.
    const cells = monthCells(new Date(2026, 8, 17))
    expect(cells.length).toBe(31)
    expect(cells[0]).toBeUndefined()
    expect(cells[1]?.getDate()).toBe(1)
  })

  it('finds the Monday-to-Sunday week of any day', () => {
    const week = weekOf(new Date(2026, 9, 11)) // a Sunday
    expect(week.map((d) => d.getDate())).toEqual([5, 6, 7, 8, 9, 10, 11])
  })
})

describe('reading a day back', () => {
  const day = '---\ndate: 2026-09-08\n---\n\n# Tuesday, 8 September 2026\n\nWent to the **market**.\n- figs\n'

  it('drops what the template wrote', () => {
    expect(stripTemplate(day)).toBe('\nWent to the **market**.\n- figs\n')
  })

  it('takes the first line written, as plain text', () => {
    expect(firstLine(day)).toBe('Went to the market.')
    expect(firstLine('# Monday\n\n- [ ] call [[Marta|M]]\n')).toBe('call M')
  })

  it('has nothing to say about an untouched day', () => {
    expect(firstLine('---\ndate: 2026-09-08\n---\n\n# Tuesday\n\n')).toBe('')
  })
})
