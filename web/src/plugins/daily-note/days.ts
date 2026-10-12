import type { Quartz } from '@quartz/plugin-api'

/**
 * Where the daily notes live. Hidden from the tree; the calendar is the way in.
 * Exported by name below rather than inline: `boundary.test.ts` reads any
 * `export` line with a quoted string on it as an import from that string.
 */
const FOLDER = 'journal'
export { FOLDER }

/** A daily note's path, capturing its day: `journal/2026-10-12.md`. */
export const DAY_NOTE = new RegExp(`^${FOLDER}/(\\d{4}-\\d{2}-\\d{2})\\.md$`)

export function pathFor(day: Date): string {
  return `${FOLDER}/${isoDay(day)}.md`
}

export async function openDay(q: Quartz, day: Date): Promise<void> {
  const path = await ensureDay(q, day)
  if (q.vault.current() !== path) await q.vault.open(path)
}

/** The day's note, written from the template if it is not there yet. */
export async function ensureDay(q: Quartz, day: Date): Promise<string> {
  const stamp = isoDay(day)
  const path = pathFor(day)

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
export function isoDay(day: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
}

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
