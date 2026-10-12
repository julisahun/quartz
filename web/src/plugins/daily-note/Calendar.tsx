import { useEffect, useMemo, useState } from 'react'
import type { NoteRef, Quartz } from '@quartz/plugin-api'
import { DAY_NOTE, isoDay, monthCells, openDay, weekOf } from './days'
import { firstLine, NoteBody } from './markdown'

type Mode = 'month' | 'week'

const MODE_KEY = 'daily-note.calendar.mode'

/**
 * The calendar, in the main pane: a month to see which days have a note, and
 * a week to read them, one day under the other.
 *
 * Only the daily notes count — `journal/YYYY-MM-DD.md` — so which days are
 * written comes from the paths alone. Text is read only for what is on
 * screen: a month's first lines, or a week's notes.
 */
export function Calendar({ q }: { q: Quartz }) {
  const { notes } = q.vault.useVault()
  const [mode, setMode] = useState<Mode>(rememberedMode)
  // Any day inside what is on show. The arrows and Today move it.
  const [anchor, setAnchor] = useState(() => new Date())

  const byDay = useMemo(() => {
    const days = new Map<string, NoteRef>()
    for (const note of notes) {
      const day = DAY_NOTE.exec(note.path)?.[1]
      if (day) days.set(day, note)
    }
    return days
  }, [notes])

  function pick(next: Mode) {
    setMode(next)
    try {
      localStorage.setItem(MODE_KEY, next)
    } catch {
      /* Storage off in a private window. The switch still switches. */
    }
  }

  function step(by: number) {
    setAnchor(
      mode === 'month'
        ? new Date(anchor.getFullYear(), anchor.getMonth() + by, 1)
        : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * by),
    )
  }

  /** An empty day in the month: go to its week, where it can be written. */
  function showWeekOf(day: Date) {
    setAnchor(day)
    pick('week')
  }

  const title =
    mode === 'month' ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : weekTitle(anchor)

  return (
    <div className="px-calv">
      <header className="px-calv-head">
        <div className="px-calv-heading">
          <h1 className="px-calv-title">{title}</h1>
          <button className="px-calv-step" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
            ‹
          </button>
          <button className="px-calv-step" onClick={() => step(1)} aria-label={`Next ${mode}`}>
            ›
          </button>
        </div>
        <div className="px-calv-controls">
          <button className="px-calv-today" onClick={() => setAnchor(new Date())}>
            Today
          </button>
          <div className="px-calv-modes" role="group" aria-label="Calendar view">
            {(['month', 'week'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => pick(m)}>
                {m === 'month' ? 'Month' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </header>
      {mode === 'month' ? (
        <Month q={q} anchor={anchor} byDay={byDay} onEmptyDay={showWeekOf} />
      ) : (
        <Week q={q} anchor={anchor} byDay={byDay} />
      )}
    </div>
  )
}

interface PageProps {
  q: Quartz
  anchor: Date
  byDay: Map<string, NoteRef>
}

/**
 * Monday first. A written day has a dot and, where there is room, its first
 * line; a phone gets the dots, and the month's notes listed underneath.
 */
function Month({ q, anchor, byDay, onEmptyDay }: PageProps & { onEmptyDay: (day: Date) => void }) {
  const today = isoDay(new Date())
  const cells = monthCells(anchor)
  const written = cells
    .filter((day): day is Date => day !== undefined)
    .map((day) => byDay.get(isoDay(day)))
    .filter((note): note is NoteRef => note !== undefined)
  const texts = useTexts(q, written)
  const label = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="px-calv-weekdays" aria-hidden="true">
        {weekdayNames('short').map((name, i) => (
          <span key={i}>{name}</span>
        ))}
      </div>
      <div className="px-calv-month" role="grid" aria-label={label}>
        {cells.map((day, i) => {
          if (!day) return <span key={`gap-${i}`} className="px-calv-gap" />
          const stamp = isoDay(day)
          const note = byDay.get(stamp)
          const line = note ? firstLine(texts.get(note.path) ?? '') : ''
          return (
            <button
              key={stamp}
              className={`px-calv-day ${note ? 'written' : ''} ${stamp === today ? 'today' : ''}`}
              onClick={() => (note ? void q.vault.open(note.path) : onEmptyDay(day))}
              aria-label={`${day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${note ? '' : ', no note'}`}
              aria-current={stamp === today ? 'date' : undefined}
            >
              <span className="px-calv-num">{day.getDate()}</span>
              {note && (
                <span className="px-calv-note">
                  <span className="px-calv-dot" aria-hidden="true" />
                  <span className="px-calv-line">{line}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
      {written.length > 0 && (
        <section className="px-calv-written" aria-label="Written this month">
          <h2>Written this month</h2>
          {[...written].reverse().map((note) => (
            <button key={note.path} className="px-calv-written-row" onClick={() => void q.vault.open(note.path)}>
              <span className="px-calv-written-day">{Number(DAY_NOTE.exec(note.path)![1].slice(8))}</span>
              <span className="px-calv-written-line">{firstLine(texts.get(note.path) ?? '') || 'Nothing written yet.'}</span>
            </button>
          ))}
        </section>
      )}
    </>
  )
}

/** Monday to Sunday, one under the other, each note as it reads. */
function Week({ q, anchor, byDay }: PageProps) {
  const today = isoDay(new Date())
  const week = weekOf(anchor)
  const notes = week.map((day) => byDay.get(isoDay(day))).filter((note): note is NoteRef => note !== undefined)
  const texts = useTexts(q, notes)

  return (
    <div className="px-calv-week">
      {week.map((day) => {
        const stamp = isoDay(day)
        const note = byDay.get(stamp)
        return (
          <section key={stamp} className={`px-calv-entry ${stamp === today ? 'today' : ''}`} aria-current={stamp === today ? 'date' : undefined}>
            <div className="px-calv-entry-head">
              <h2>{day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric' })}</h2>
              <span className="px-calv-entry-month">{day.toLocaleDateString(undefined, { month: 'long' })}</span>
              <span className="px-calv-spacer" />
              {note && (
                <button className="px-calv-open" onClick={() => void q.vault.open(note.path)}>
                  Open
                </button>
              )}
            </div>
            {note ? (
              texts.has(note.path) ? (
                <NoteBody text={texts.get(note.path)!} />
              ) : (
                <p className="px-md-empty">Reading…</p>
              )
            ) : (
              <button className="px-calv-write" onClick={() => void openDay(q, day)}>
                <span>No note</span>
                <span className="px-calv-write-action">Write</span>
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** The text of each note, re-read when one of them changes. */
function useTexts(q: Quartz, notes: NoteRef[]): Map<string, string> {
  const [texts, setTexts] = useState(() => new Map<string, string>())
  // What the reads depend on, as one string: an array rebuilt every render
  // would make the effect run every render.
  const key = notes.map((note) => `${note.path}@${note.mtime}`).join('\n')

  useEffect(() => {
    let live = true
    void Promise.all(
      notes.map(async (note) => {
        try {
          return [note.path, await q.vault.read(note.path)] as const
        } catch {
          // Not on this device yet. The day still opens it.
          return [note.path, ''] as const
        }
      }),
    ).then((pairs) => {
      if (live) setTexts(new Map(pairs))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, key])

  return texts
}

/** Monday to Sunday, in the device's language. 2024-01-01 was a Monday. */
function weekdayNames(width: 'short' | 'narrow'): string[] {
  return Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: width }))
}

function weekTitle(day: Date): string {
  const [first, , , , , , last] = weekOf(day)
  const sameMonth = first.getMonth() === last.getMonth()
  const start = first.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  const end = last.toLocaleDateString(undefined, { day: 'numeric', month: sameMonth ? 'long' : 'short' })
  return `${start} – ${end}`
}

function rememberedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'week' ? 'week' : 'month'
  } catch {
    return 'month'
  }
}
