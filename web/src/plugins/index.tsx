import { addToSlot } from '../ui/Slot'
import type { QuartzPlugin } from '@quartz/plugin-api'
import { dailyNote } from './daily-note'
import { properties } from './properties'
import { wordCount } from './word-count'
import { Marketplace } from './Marketplace'
import { startPlugins as startCatalogue } from './manager'
import './plugins.css'

export type { Quartz, QuartzPlugin } from '@quartz/plugin-api'

/**
 * What ships — the catalogue, not the running set.
 *
 * Bundled, in tree, and in this order: there is no install step that fetches
 * anything, and no plugin runs that is not on this list. What changed is that
 * being on the list only makes a plugin *offerable* — none of them start until
 * someone turns it on in the marketplace, which is why deleting a line here is
 * no longer the only way to be rid of one.
 */
export const bundled: QuartzPlugin[] = [properties, dailyNote, wordCount]

/**
 * Starts the plugins that are turned on, and offers the rest.
 *
 * Returns the teardown, which only tests use. The marketplace goes into the
 * settings screen from here rather than from the screen itself: `SettingsView`
 * renders whatever is in `settings.sections` without knowing that plugins are
 * one of the things that might be.
 */
export function startPlugins(catalogue: QuartzPlugin[] = bundled): () => void {
  return startCatalogue(catalogue, () =>
    addToSlot('settings.sections', { id: 'plugins', order: 50, render: () => <Marketplace /> }),
  )
}
