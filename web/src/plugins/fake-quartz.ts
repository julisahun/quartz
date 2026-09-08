import { useMemo } from 'react'
import { folderOf, noteTitle } from '../state/notes'
import type { Command } from '../state/commands'
import type { NoteRef, Quartz, VaultSnapshot } from './api'
import { parseFrontmatter } from '../state/frontmatter'
import { tagKey } from '../state/tags'

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

export function fakeQuartz(files: Record<string, string> = {}): FakeQuartz {
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
        return parseFrontmatter(await q.vault.read(path))
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
        q.commands_.push(command as Command)
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
