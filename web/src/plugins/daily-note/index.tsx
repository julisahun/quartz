import type { QuartzPlugin } from '@quartz/plugin-api'
import { Calendar } from './Calendar'
import { ensureDay, FOLDER, openDay } from './days'

export { isoDay, monthCells, weekOf } from './days'

/**
 * A note per day, in `journal/`, and a calendar to find them by.
 *
 * The one piece of automation almost every notes app grows, and a fair test of
 * the API: it looks the vault up, creates a note if it has to, writes a
 * template into it and opens it — without knowing anything about how any of
 * those are stored. The template is frontmatter and a heading, which is what
 * Obsidian would have written too.
 *
 * The calendar is how the days are reached, so `journal/` leaves the note
 * tree while this is on — search and ⌘P still find what is in it. It offers
 * two homes: today's note, which is the one it starts as, and the calendar
 * itself, to pick instead in Settings.
 */
export const dailyNote: QuartzPlugin = {
  id: 'daily-note',
  name: 'Daily note',
  description:
    "A note per day in journal/, reached from a calendar — a month to see the days, a week to read them — instead of the note list.",
  author: 'Quartz',
  version: '2.0.0',
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
    q.commands.add({
      id: 'calendar',
      title: 'Open the calendar',
      run: () => q.ui.openView('calendar'),
    })

    q.ui.view({ id: 'calendar', title: 'Calendar', render: () => <Calendar q={q} /> })
    q.ui.sidebarButton({ id: 'calendar', label: 'Calendar', icon: CalendarIcon, view: 'calendar' })
    q.ui.hideFromTree((path) => path.startsWith(`${FOLDER}/`))

    // The first is the home this plugin takes; the second is the alternative.
    q.home.provide({ id: 'today', label: "Today's note", resolve: () => ensureDay(q, new Date()) })
    q.home.provide({ id: 'calendar', label: 'Calendar', resolve: async () => ({ view: 'calendar' }) })
  },
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  )
}
