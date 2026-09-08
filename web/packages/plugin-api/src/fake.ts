import { useMemo } from 'react'
import type { Command, NoteRef, Property, Quartz, VaultSnapshot } from './api'
import { folderOf, noteTitle, tagKey } from './paths'

/**
 * A Quartz for tests: a vault held in a Map, and registries that record.
 *
 * The reason plugins take `Quartz` as an argument rather than importing the
 * app is exactly this — every one of them can be driven against a vault of
 * three notes without a store, a database or a server anywhere near it.
 */
export interface FakeQuartz extends Quartz {
  /** Path to text. Write to it directly to set a test up. */
  files: Map<string, string>
  /** What the plugin registered, in the order it did. */
  commands_: Command[]
  sections: Array<{ id: string; title: string; order?: number }>
  statusItems: string[]
  panels: string[]
  notices: Array<{ kind: string; text: string }>
  /** Notes opened, oldest first. The last one is what is on screen. */
  opened: string[]
  current: string | undefined
  /** Runs a registered command by the id it was given. */
  run(id: string): Promise<void>
}

export interface FakeOptions {
  /**
   * How a note's text becomes properties. Nothing has any, without one.
   *
   * Passed in rather than implemented here, because parsing frontmatter is the
   * app's behaviour and not the contract's: Quartz reads it with the same
   * parser the editor highlights it with, and a second parser in this package
   * would be a second set of rules for what counts as a top-level key. A test
   * that cares what the real one does hands it over — the app's own plugin
   * tests pass `parseFrontmatter` — and one that only cares about properties
   * can hand over something that returns them.
   */
  frontmatter?: (text: string) => Property[]
}

export function fakeQuartz(files: Record<string, string> = {}, options: FakeOptions = {}): FakeQuartz {
  const q: FakeQuartz = {
    files: new Map(Object.entries(files)),
    commands_: [],
    sections: [],
    statusItems: [],
    panels: [],
    notices: [],
    opened: [],
    current: undefined,

    async run(id) {
      const command = q.commands_.find((c) => c.id === id)
      if (!command) throw new Error(`no command ${id}`)
      await command.run()
    },

    vault: {
      notes: () => [...q.files.keys()].filter((p) => p.endsWith('.md')).map(refFor),
      current: () => q.current,
      async read(path) {
        const text = q.files.get(path)
        if (text === undefined) throw new Error(`${path} is not here`)
        return text
      },
      async frontmatter(path) {
        const text = await q.vault.read(path)
        return options.frontmatter?.(text) ?? []
      },
      tags: () => [],
      taggedWith: (tag) => {
        const key = tagKey(tag)
        return [...q.files].filter(([, text]) => text.includes(`#${key}`)).map(([path]) => path)
      },
      backlinks: () => [],
      async search() {
        return []
      },
      async open(path) {
        q.opened.push(path)
        q.current = path
      },
      async create(title, folder = '') {
        const path = folder ? `${folder}/${title}.md` : `${title}.md`
        q.files.set(path, `# ${title}\n\n`)
        await q.vault.open(path)
        return path
      },
      async write(path, text) {
        q.files.set(path, text)
      },
      subscribe: () => () => {},
      // Memoised the way the real one is. A snapshot rebuilt on every render
      // is a new `notes` array on every render, and any effect watching it
      // spins — which is a property of the fake, not of the plugin under test.
      useVault(): VaultSnapshot {
        const paths = [...q.files.keys()].join('\n')
        const current = q.current
        const text = current ? (q.files.get(current) ?? '') : ''
        // eslint-disable-next-line react-hooks/exhaustive-deps
        return useMemo(() => ({ notes: q.vault.notes(), current, text, tags: [] }), [paths, current, text])
      },
    },

    commands: {
      add(command) {
        q.commands_.push(command)
      },
    },

    ui: {
      sidebarSection({ id, title, order }) {
        q.sections.push({ id, title, order })
      },
      statusItem({ id }) {
        q.statusItems.push(id)
      },
      notePanel({ id }) {
        q.panels.push(id)
      },
      notify(kind, text) {
        q.notices.push({ kind, text })
      },
      ask: {
        async text() {
          return null
        },
        async confirm() {
          return false
        },
        async menu() {
          return null
        },
      },
    },
  }

  return q
}

function refFor(path: string): NoteRef {
  return { path, title: noteTitle(path), folder: folderOf(path), mtime: 0, size: 0 }
}
