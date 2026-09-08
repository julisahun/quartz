import { useMemo } from 'react'
import { addCommand } from '../state/commands'
import { parseFrontmatter } from '../state/frontmatter'
import { folderOf, isNote, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { tagKey } from '../state/tags'
import { askConfirm, askText, openMenu } from '../ui/dialogs'
import { addToSlot } from '../ui/Slot'
import type { FileMeta } from '../vault/types'
import type { NoteRef, Quartz, QuartzPlugin, VaultSnapshot } from './api'

/**
 * The only file that knows what a plugin is.
 *
 * Everything below it — the command registry, the slots, the store — is a
 * plain part of the app that would exist anyway; everything above it is a
 * plugin. Delete `src/plugins/` and the two lines in `main.tsx` that call
 * this, and nothing else in the tree has to change.
 */
export function mount(plugins: QuartzPlugin[]): () => void {
  const disposers: Array<() => void> = []

  for (const plugin of plugins) {
    const mine: Array<() => void> = []
    try {
      const teardown = plugin.setup(quartzFor(plugin, mine))
      if (teardown) mine.push(teardown)
    } catch (err) {
      // One plugin failing to start is not a reason for the rest not to.
      console.error(`plugin ${plugin.id} failed to start`, err)
    }
    disposers.push(...mine)
  }

  return () => {
    // Backwards, so a plugin comes apart in the order it was put together.
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (err) {
        console.error('a plugin failed to shut down', err)
      }
    }
  }
}

function quartzFor(plugin: QuartzPlugin, disposers: Array<() => void>): Quartz {
  const scoped = (id: string) => `${plugin.id}/${id}`

  return {
    vault: vaultApi(),
    commands: {
      add(command) {
        disposers.push(addCommand({ ...command, id: scoped(command.id) }))
      },
    },
    ui: {
      sidebarSection(section) {
        disposers.push(
          addToSlot('sidebar.sections', {
            id: scoped(section.id),
            order: section.order,
            render: () => section.render(),
          }),
        )
      },
      statusItem(item) {
        disposers.push(
          addToSlot('status.items', { id: scoped(item.id), order: item.order, render: () => item.render() }),
        )
      },
      notePanel(panel) {
        disposers.push(
          addToSlot('note.panels', {
            id: scoped(panel.id),
            order: panel.order,
            // A panel about the open note has nothing to say when none is.
            render: ({ path }) => (path ? panel.render(path) : null),
          }),
        )
      },
      notify(kind, text) {
        useApp.getState().notify(kind, text)
      },
      ask: { text: askText, confirm: askConfirm, menu: openMenu },
    },
  }
}

function vaultApi(): Quartz['vault'] {
  const app = () => useApp.getState()

  return {
    notes: () => notesOf(app().files),
    current: () => app().currentPath,
    read: (path) => app().readNote(path),
    async frontmatter(path) {
      return parseFrontmatter(await app().readNote(path))
    },
    tags: () => app().tags,
    taggedWith(tag) {
      const key = tagKey(tag)
      return app().tags.find((summary) => summary.key === key)?.paths ?? []
    },
    backlinks: () => app().backlinks,
    search: (query) => app().search(query),
    open: (path) => app().open(path),
    create: (title, folder) => app().createNote(title, folder),
    async write(path, text) {
      const state = app()
      if (state.currentPath !== path) await state.open(path)
      app().edit(text)
      await app().save()
    },
    subscribe(fn) {
      return useApp.subscribe((s, prev) => {
        if (s.files !== prev.files || s.tags !== prev.tags || s.currentPath !== prev.currentPath) fn()
      })
    },
    useVault,
  }
}

/**
 * The reactive half.
 *
 * Three separate selectors rather than one returning an object: zustand
 * compares what a selector hands back, and a fresh object every time is a
 * render every time.
 */
function useVault(): VaultSnapshot {
  const files = useApp((s) => s.files)
  const current = useApp((s) => s.currentPath)
  const text = useApp((s) => s.content)
  const tags = useApp((s) => s.tags)
  const notes = useMemo(() => notesOf(files), [files])
  return useMemo(() => ({ notes, current, text, tags }), [notes, current, text, tags])
}

function notesOf(files: FileMeta[]): NoteRef[] {
  return files
    .filter((file) => isNote(file.path))
    .map((file) => ({
      path: file.path,
      title: noteTitle(file.path),
      folder: folderOf(file.path),
      mtime: file.mtime,
      size: file.size,
    }))
}
