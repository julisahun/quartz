import type { QuartzPlugin } from './api'
import { dailyNote } from './daily-note'
import { mount } from './host'
import { properties } from './properties'
import { wordCount } from './word-count'
import './plugins.css'

export type { Quartz, QuartzPlugin } from './api'

/**
 * What ships.
 *
 * Bundled, in tree, and in this order — there is no install step, and no
 * plugin runs that is not on this list. Turning one off is deleting a line,
 * which for a list this length is the right amount of machinery.
 */
export const bundled: QuartzPlugin[] = [properties, dailyNote, wordCount]

/** Starts every bundled plugin. Returns the teardown, which only tests use. */
export function startPlugins(plugins: QuartzPlugin[] = bundled): () => void {
  return mount(plugins)
}
