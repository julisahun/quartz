import { createElement, useMemo, type ReactNode } from 'react'
import { addCommand } from '../state/commands'
import { hideFromTree } from '../state/hidden'
import { addHomeSource } from '../state/home'
import { parseFrontmatter } from '../state/frontmatter'
import { folderOf, isNote, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { tagKey } from '../state/tags'
import { askConfirm, askText, openMenu } from '../ui/dialogs'
import { addToSlot } from '../ui/Slot'
import { addView } from '../ui/views'
import type { FileMeta } from '../vault/types'
import type { NoteRef, Quartz, QuartzPlugin, VaultSnapshot } from '@quartz/plugin-api'

/**
 * The only file that knows what a plugin is.
 *
 * Everything below it — the command registry, the slots, the store — is a
 * plain part of the app that would exist anyway; everything above it is a
 * plugin. Delete `src/plugins/` and the two lines in `main.tsx` that call
 * this, and nothing else in the tree has to change.
 */

/**
 * Starts one plugin, and hands back the teardown for everything it registered.
 *
 * One at a time rather than a set, because a plugin can now be turned on and
 * off while the app is running: the marketplace holds one of these per plugin
 * and calls it when a row is switched off.
 */
export function start(plugin: QuartzPlugin): () => void {
  const mine: Array<() => void> = []

  try {
    const teardown = plugin.setup(quartzFor(plugin, mine))
    if (teardown) mine.push(teardown)
  } catch (err) {
    // A plugin failing to start is a bug in that plugin, not a reason for the
    // app to come up without the others — or without its notes. Whatever it
    // managed to register before throwing stays, and comes out below.
    console.error(`plugin ${plugin.id} failed to start`, err)
  }

  return () => {
    // Backwards, so a plugin comes apart in the order it was put together.
    for (const dispose of mine.reverse()) {
      try {
        dispose()
      } catch (err) {
        console.error(`plugin ${plugin.id} failed to shut down`, err)
      }
    }
    mine.length = 0
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
      view(view) {
        disposers.push(addView({ id: scoped(view.id), title: view.title, render: () => view.render() }))
      },
      openView(id) {
        void useApp.getState().openView(scoped(id))
      },
      sidebarButton(button) {
        const view = scoped(button.view)
        disposers.push(
          addToSlot('sidebar.buttons', {
            id: scoped(button.id),
            order: button.order,
            render: () => createElement(ViewButton, { label: button.label, icon: button.icon, view }),
          }),
        )
      },
      hideFromTree(hide) {
        disposers.push(hideFromTree(hide))
      },
      notify(kind, text) {
        useApp.getState().notify(kind, text)
      },
      ask: { text: askText, confirm: askConfirm, menu: openMenu },
    },
    home: {
      provide(home) {
        disposers.push(
          addHomeSource({
            id: scoped(home.id),
            label: home.label,
            by: plugin.name,
            group: plugin.id,
            // A view is named the way the plugin registered it, and lives
            // under the plugin's namespace like everything else it adds.
            resolve: async () => {
              const found = await home.resolve()
              return found && typeof found === 'object' ? { view: scoped(found.view) } : found
            },
          }),
        )
      },
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

/**
 * A header button that opens a view, pressed while it is open. Pressed again,
 * it closes the view and hands the pane back to the note under it.
 */
function ViewButton({ label, icon, view }: { label: string; icon: () => ReactNode; view: string }) {
  const open = useApp((s) => s.currentView === view)
  return createElement(
    'button',
    {
      className: `icon-button${open ? ' pressed' : ''}`,
      'aria-label': label,
      'aria-pressed': open,
      title: label,
      onClick: () => {
        const app = useApp.getState()
        if (open) app.closeView()
        else void app.openView(view)
      },
    },
    icon(),
  )
}
