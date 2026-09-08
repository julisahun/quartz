import type { Quartz, QuartzPlugin } from '@quartz/plugin-api'

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
 */
export const dailyNote: QuartzPlugin = {
  id: 'daily-note',
  name: 'Daily note',
  description: "Opens today's or yesterday's note in journal/, writing it from a template the first time.",
  author: 'Quartz',
  version: '1.0.0',
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
  },
}

const FOLDER = 'journal'

async function openDay(q: Quartz, day: Date): Promise<void> {
  const stamp = isoDay(day)
  const path = `${FOLDER}/${stamp}.md`

  // Already there: open it and leave it alone. Re-templating a day that has
  // been written in would be the worst bug this plugin could have.
  if (q.vault.notes().some((note) => note.path === path)) {
    await q.vault.open(path)
    return
  }

  const made = await q.vault.create(stamp, FOLDER)
  // `create` makes the path unique, so a collision with something not listed
  // as a note lands somewhere else — say so rather than pretending.
  if (made !== path) q.ui.notify('info', `Today's note went to ${made}`)
  await q.vault.write(made, template(day, stamp))
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
