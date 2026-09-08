import { useEffect, useMemo, useRef, useState } from 'react'
import type { Property } from '../../state/frontmatter'
import type { NoteRef, Quartz, QuartzPlugin } from '../api'
import { Section } from '../Section'

/**
 * Notes grouped by a frontmatter property.
 *
 * The vault's own answer to a Dataview table, without a query language and
 * without putting anything in a note: the properties come from the notes that
 * already have them, and the results live in the sidebar. Nothing about this
 * is visible in Obsidian, which is the point — a query that goes stale in
 * another editor is worse than no query.
 */
export const properties: QuartzPlugin = {
  id: 'properties',
  name: 'By property',
  description: 'Groups the notes in the sidebar by a frontmatter property, discovered from the notes that have one.',
  author: 'Quartz',
  version: '1.0.0',
  icon: '≡',
  setup(q) {
    q.ui.sidebarSection({
      id: 'by-property',
      title: 'By property',
      order: 10,
      render: () => <ByProperty q={q} />,
    })
  },
}

/** What one note contributes, keyed by the hash so a re-read is only on change. */
interface Scanned {
  hash: string
  properties: Map<string, string[]>
}

function ByProperty({ q }: { q: Quartz }) {
  const { notes } = q.vault.useVault()

  return (
    <Section id="properties" title="By property">
      {(open) => (open ? <Grouped q={q} notes={notes} /> : null)}
    </Section>
  )
}

/**
 * Split from the section so the scan only mounts when it is open — reading
 * every note in the vault is not something to do behind a closed panel.
 */
function Grouped({ q, notes }: { q: Quartz; notes: NoteRef[] }) {
  const scan = useScan(q, notes)
  const [chosen, setChosen] = useState<string | undefined>()

  const keys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { properties } of scan.values()) {
      for (const key of properties.keys()) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    // Commonest first: the property most of the vault carries is the one most
    // likely to be worth grouping by.
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key)
  }, [scan])

  // Whatever was picked, until it stops existing; otherwise the commonest.
  const key = chosen && keys.includes(chosen) ? chosen : keys[0]

  const titles = useMemo(() => new Map(notes.map((note) => [note.path, note.title])), [notes])

  const groups = useMemo(() => {
    if (!key) return []
    const byValue = new Map<string, string[]>()
    for (const [path, { properties }] of scan) {
      for (const value of properties.get(key) ?? []) {
        const into = byValue.get(value)
        if (into) into.push(path)
        else byValue.set(value, [path])
      }
    }
    return [...byValue].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }, [scan, key])

  if (scan.size === 0) {
    return <p className="empty">{notes.length ? 'Reading…' : 'No notes yet.'}</p>
  }
  if (!key) {
    return <p className="empty">No note here has frontmatter yet.</p>
  }

  return (
    <div className="px-property">
      <select
        className="px-property-pick"
        value={key}
        onChange={(event) => setChosen(event.target.value)}
        aria-label="Property to group by"
      >
        {keys.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      <div className="px-groups">
        {groups.map(([value, paths]) => (
          <div className="px-group" key={value}>
            <div className="px-group-head">
              <span className="px-group-value">{value}</span>
              <span className="px-group-count">{paths.length}</span>
            </div>
            {paths.map((path) => (
              <button className="px-group-note" key={path} onClick={() => void q.vault.open(path)}>
                {titles.get(path) ?? path}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Every note's frontmatter, re-read only where it moved.
 *
 * A vault is thousands of files and the property list is not worth reading
 * them twice for, so a note is scanned once per hash and cached against it.
 * Notes that have gone are dropped, which is also what keeps a rename from
 * showing under both names.
 */
function useScan(q: Quartz, notes: NoteRef[]): Map<string, Scanned> {
  const cache = useRef(new Map<string, Scanned>())
  // A copy, not the cache itself: the cache is mutated in place, and something
  // whose identity never changes is something the memos below never re-run for.
  const [scanned, setScanned] = useState<Map<string, Scanned>>(() => new Map())

  useEffect(() => {
    let live = true

    void (async () => {
      const seen = new Set<string>()
      let changed = false

      for (const note of notes) {
        seen.add(note.path)
        // The mtime stands in for the hash: NoteRef carries it, and a note
        // that has not been written has not changed.
        const stamp = String(note.mtime)
        if (cache.current.get(note.path)?.hash === stamp) continue
        try {
          const props = await q.vault.frontmatter(note.path)
          if (!live) return
          cache.current.set(note.path, { hash: stamp, properties: valuesOf(props) })
          changed = true
        } catch {
          // A note that cannot be read right now simply contributes nothing.
          cache.current.delete(note.path)
        }
      }

      for (const path of [...cache.current.keys()]) {
        if (!seen.has(path)) {
          cache.current.delete(path)
          changed = true
        }
      }
      if (live && changed) setScanned(new Map(cache.current))
    })()

    return () => {
      live = false
    }
  }, [q, notes])

  return scanned
}

/**
 * A note's frontmatter as values worth grouping on.
 *
 * A list property groups under each of its entries — `tags: [a, b]` belongs to
 * both — because that is what makes a list worth writing in the first place.
 */
function valuesOf(props: Property[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const prop of props) {
    const values = (Array.isArray(prop.value) ? prop.value : [prop.value])
      .map((value) => value.trim())
      .filter((value) => value !== '')
    if (values.length > 0) out.set(prop.key, values)
  }
  return out
}
