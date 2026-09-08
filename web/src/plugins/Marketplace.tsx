import { useMemo, useState } from 'react'
import type { QuartzPlugin } from './api'
import { install, uninstall, useCatalogue, useRunning } from './manager'

/**
 * The plugin marketplace, in the settings screen.
 *
 * Shaped like a store — a search field, installed above available, a button
 * per row — because that is the shape people already know how to read, and
 * because the rows are a catalogue rather than a settings form: a plugin has a
 * name, an author, a version and a sentence about what it does.
 *
 * What it is honest about is where the code comes from. These ship with the
 * app, so "install" costs no download and takes effect on the tap rather than
 * on a restart, and the list only grows when the app does. The footer says so,
 * because a store that looks like it reaches somewhere is one people will
 * wonder why they cannot search.
 */
export function Marketplace() {
  const catalogue = useCatalogue()
  const running = useRunning()
  const [query, setQuery] = useState('')

  const matches = useMemo(() => filter(catalogue, query), [catalogue, query])
  const installed = matches.filter((plugin) => running.includes(plugin.id))
  const available = matches.filter((plugin) => !running.includes(plugin.id))

  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <h2>Plugins</h2>
        <input
          className="search px-market-search"
          type="search"
          value={query}
          placeholder="Search plugins"
          aria-label="Search plugins"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {catalogue.length === 0 ? (
        <p className="empty">This build ships no plugins.</p>
      ) : matches.length === 0 ? (
        <p className="empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        <>
          <Group
            title="Installed"
            plugins={installed}
            // Only worth saying when there is a list to be empty. With a search
            // running, an empty half is the search's doing and needs no notice.
            empty={query.trim() === '' ? 'Nothing turned on yet.' : undefined}
            action="Remove"
            onAction={uninstall}
          />
          <Group title="Available" plugins={available} action="Install" onAction={install} />
        </>
      )}

      <p className="px-market-note muted">
        These ship with Quartz and run on this device only — turning one on here does not
        turn it on elsewhere. The list grows when the app updates.
      </p>
    </section>
  )
}

function Group({
  title,
  plugins,
  empty,
  action,
  onAction,
}: {
  title: string
  plugins: QuartzPlugin[]
  empty?: string
  action: string
  onAction: (id: string) => void
}) {
  if (plugins.length === 0 && empty === undefined) return null

  return (
    <div className="px-market-group">
      <h3 className="px-market-group-head">
        {title} <span className="px-market-count">{plugins.length}</span>
      </h3>
      {plugins.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <ul className="px-market-list">
          {plugins.map((plugin) => (
            <li className="px-market-row" key={plugin.id}>
              <span className="px-market-icon" aria-hidden="true">
                {plugin.icon ?? plugin.name.slice(0, 1)}
              </span>
              <div className="px-market-text">
                <div className="px-market-name">
                  {plugin.name}
                  {plugin.version && <span className="px-market-version">{plugin.version}</span>}
                </div>
                <p className="px-market-desc">{plugin.description}</p>
                {plugin.author && <p className="px-market-author">{plugin.author}</p>}
              </div>
              <button
                className="button px-market-action"
                onClick={() => onAction(plugin.id)}
                // Two rows can carry the same verb, so the name has to be in
                // the label a screen reader reads out.
                aria-label={`${action} ${plugin.name}`}
              >
                {action}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Name and description both, so "journal" finds the daily note. */
function filter(catalogue: QuartzPlugin[], query: string): QuartzPlugin[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return catalogue
  return catalogue.filter((plugin) =>
    `${plugin.name} ${plugin.description}`.toLowerCase().includes(needle),
  )
}
