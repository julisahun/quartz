import { useEffect, useMemo, useState } from 'react'
import { Section, type NoteRef, type Quartz, type QuartzPlugin } from '@quartz/plugin-api'

/**
 * A note per day, in `journal/`.
 *
 * The one piece of automation almost every notes app grows, and a fair test of
 * the command half of the API: it looks the vault up, creates a note if it has
 * to, writes a template into it and opens it — without knowing anything about
 * how any of those are stored.
 *
 * The template is frontmatter and a heading, which is what Obsidian would have
 * written too. Nothing here is Quartz-only.
 *
 * The calendar in the sidebar is the same thing with somewhere to tap — the
 * commands need ⌘P, which a phone does not have — and today's note is offered
 * as the vault's home, so the app opens on it.
 */
export const dailyNote: QuartzPlugin = {
  id: 'daily-note',
  name: 'Daily note',
  description:
    "A note per day in journal/: a month and week calendar in the sidebar, and today's note as the home the app opens on.",
  author: 'Quartz',
  version: '1.1.0',
  icon: '◷',
  setup(q) {
    q.commands.add({
      id: 'today',
      title: "Open today's note",
      run: () => openDay(q, new Date()),
    })
    q.commands.add({
      id: 'yesterday',
      title: "Open yesterday's note",
      run: () => openDay(q, new Date(Date.now() - 864e5)),
    })
    q.home.provide({
      id: 'today',
      label: "Today's note",
      resolve: () => ensureDay(q, new Date()),
    })
    q.ui.sidebarSection({
      id: 'calendar',
      title: 'Calendar',
      order: 5,
      render: () => <Calendar q={q} />,
    })
  },
}

const FOLDER = 'journal'

async function openDay(q: Quartz, day: Date): Promise<void> {
  const path = await ensureDay(q, day)
  if (q.vault.current() !== path) await q.vault.open(path)
}

/** The day's note, written from the template if it is not there yet. */
async function ensureDay(q: Quartz, day: Date): Promise<string> {
  const stamp = isoDay(day)
  const path = `${FOLDER}/${stamp}.md`

  // Already there: leave it alone. Re-templating a day that has been written
  // in would be the worst bug this plugin could have.
  if (q.vault.notes().some((note) => note.path === path)) return path

  const made = await q.vault.create(stamp, FOLDER)
  // `create` makes the path unique, so a collision with something not listed
  // as a note lands somewhere else — say so rather than pretending.
  if (made !== path) q.ui.notify('info', `The note for ${stamp} went to ${made}`)
  await q.vault.write(made, template(day, stamp))
  return made
}

function template(day: Date, stamp: string): string {
  const heading = day.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return `---\ndate: ${stamp}\n---\n\n# ${heading}\n\n`
}

/** The local day, not UTC: a note for "today" written at 23:00 is today's. */
function isoDay(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

const DAY_NOTE = new RegExp(`^${FOLDER}/(\\d{4}-\\d{2}-\\d{2})\\.md$`)

type View = 'month' | 'week'

const VIEW_KEY = 'daily-note.calendar.view'

function Calendar({ q }: { q: Quartz }) {
  return (
    <Section id="daily-note.calendar" title="Calendar">
      {(open) => (open ? <Pages q={q} /> : null)}
    </Section>
  )
}

/**
 * The month or the week around one day, with arrows and a way back to today.
 *
 * Only the daily notes count — `journal/YYYY-MM-DD.md`, the files the commands
 * write — so knowing which days have one costs nothing: it comes from the
 * paths, and no note is read to draw a month.
 */
function Pages({ q }: { q: Quartz }) {
  const { notes, current } = q.vault.useVault()
  const [view, setView] = useState<View>(rememberedView)
  // Any day inside what is on show. Only the arrows and Today move it.
  const [anchor, setAnchor] = useState(() => new Date())

  const days = useMemo(() => {
    const byDay = new Map<string, NoteRef>()
    for (const note of notes) {
      const day = DAY_NOTE.exec(note.path)?.[1]
      if (day) byDay.set(day, note)
    }
    return byDay
  }, [notes])

  const open = current ? DAY_NOTE.exec(current)?.[1] : undefined

  function pick(next: View) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* Storage off in a private window. The switch still switches. */
    }
  }

  function step(by: number) {
    setAnchor(
      view === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() + by, 1)
        : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * by),
    )
  }

  const title =
    view === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : weekTitle(anchor)

  return (
    <div className="px-cal">
      <div className="px-cal-head">
        <button className="px-cal-step" onClick={() => step(-1)} aria-label={`Previous ${view}`}>
          ‹
        </button>
        <span className="px-cal-title">{title}</span>
        <button className="px-cal-step" onClick={() => step(1)} aria-label={`Next ${view}`}>
          ›
        </button>
      </div>
      <div className="px-cal-bar">
        <div className="px-cal-views" role="group" aria-label="Calendar view">
          {(['month', 'week'] as const).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => pick(v)}>
              {v === 'month' ? 'Month' : 'Week'}
            </button>
          ))}
        </div>
        <button
          className="px-cal-today"
          onClick={() => {
            setAnchor(new Date())
            void openDay(q, new Date())
          }}
        >
          Today
        </button>
      </div>
      {view === 'month' ? (
        <MonthGrid q={q} anchor={anchor} days={days} open={open} />
      ) : (
        <WeekList q={q} anchor={anchor} days={days} open={open} />
      )}
    </div>
  )
}

interface PageProps {
  q: Quartz
  anchor: Date
  days: Map<string, NoteRef>
  open: string | undefined
}

/** Monday first, with a dot on every day that has a note. */
function MonthGrid({ q, anchor, days, open }: PageProps) {
  const today = isoDay(new Date())
  const label = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="px-cal-grid" role="grid" aria-label={label}>
      {WEEKDAYS.map((name, i) => (
        // By position: narrow names repeat (T, T; S, S).
        <span className="px-cal-weekday" key={i} aria-hidden="true">
          {name}
        </span>
      ))}
      {monthCells(anchor).map((day, i) => {
        if (!day) return <span key={`gap-${i}`} />
        const stamp = isoDay(day)
        const classes = ['px-cal-day']
        if (stamp === today) classes.push('today')
        if (stamp === open) classes.push('open')
        if (days.has(stamp)) classes.push('written')
        return (
          <button
            key={stamp}
            className={classes.join(' ')}
            onClick={() => void openDay(q, day)}
            aria-label={day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            aria-current={stamp === today ? 'date' : undefined}
          >
            {day.getDate()}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Seven rows, each with the start of what was written that day.
 *
 * A reader for the week rather than a slice of the month: what was written,
 * without opening seven notes to find out. At most seven reads, and only
 * while the section is open on this view.
 */
function WeekList({ q, anchor, days, open }: PageProps) {
  const today = isoDay(new Date())
  const week = weekOf(anchor)
  const previews = usePreviews(
    q,
    week.map((day) => days.get(isoDay(day))).filter((note): note is NoteRef => note !== undefined),
  )

  return (
    <ul className="px-cal-week">
      {week.map((day) => {
        const stamp = isoDay(day)
        const note = days.get(stamp)
        const classes = ['px-cal-row']
        if (stamp === today) classes.push('today')
        if (stamp === open) classes.push('open')
        return (
          <li key={stamp}>
            <button
              className={classes.join(' ')}
              onClick={() => void openDay(q, day)}
              aria-current={stamp === today ? 'date' : undefined}
            >
              <span className="px-cal-row-day">
                <span className="px-cal-row-name">{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="px-cal-row-date">{day.getDate()}</span>
              </span>
              <span className={`px-cal-row-text ${note ? '' : 'empty'}`}>
                {note ? (previews.get(note.path) ?? '') : 'No note'}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The opening text of each note, re-read when one of them changes. */
function usePreviews(q: Quartz, notes: NoteRef[]): Map<string, string> {
  const [previews, setPreviews] = useState(() => new Map<string, string>())
  // What the reads depend on, as one string: an array rebuilt every render
  // would make the effect run every render.
  const key = notes.map((note) => `${note.path}@${note.mtime}`).join('\n')

  useEffect(() => {
    let live = true
    void Promise.all(
      notes.map(async (note) => {
        try {
          return [note.path, preview(await q.vault.read(note.path))] as const
        } catch {
          // Not on this device yet. The row still opens it.
          return [note.path, ''] as const
        }
      }),
    ).then((pairs) => {
      if (live) setPreviews(new Map(pairs))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, key])

  return previews
}

/**
 * What a note says, minus what the template put there: the frontmatter and
 * the first heading, which only repeat the date the row already shows.
 */
export function preview(text: string): string {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s*#\s[^\n]*\n?/, '')
  return body.replace(/\s+/g, ' ').trim().slice(0, 200)
}

/** Monday to Sunday, in the device's language. 2024-01-01 was a Monday. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
)

/** The month's days, padded in front so the 1st lands under its weekday. */
export function monthCells(anchor: Date): Array<Date | undefined> {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const lead = (first.getDay() + 6) % 7 // Monday is 0
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells: Array<Date | undefined> = Array.from({ length: lead }, () => undefined)
  for (let d = 1; d <= length; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d))
  return cells
}

/** The Monday-to-Sunday week a day falls in. */
export function weekOf(day: Date): Date[] {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
}

function weekTitle(day: Date): string {
  const week = weekOf(day)
  const short = { day: 'numeric', month: 'short' } as const
  return `${week[0].toLocaleDateString(undefined, short)} – ${week[6].toLocaleDateString(undefined, short)}`
}

function rememberedView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'
  } catch {
    return 'month'
  }
}
