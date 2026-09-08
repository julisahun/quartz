import type { ReactNode } from 'react'
import type { SearchHit } from '../api/client'
import type { Property } from '../state/frontmatter'
import type { Backlink } from '../state/links'
import type { TagSummary } from '../state/vault-index'
import type { MenuItem } from '../ui/dialogs'

/**
 * What a plugin is handed, and all it is meant to need.
 *
 * Plugins are compiled into the app, so this is a convention rather than a
 * wall: a plugin that needs something exotic can import the module that has
 * it, the same as any other file here. The point of keeping this surface
 * small is that everything reached through it is the part promised to keep
 * working — anything else is a plugin holding the app's internals, and it
 * breaks when they move.
 */
export interface Quartz {
  vault: VaultApi
  commands: CommandApi
  ui: UiApi
}

export interface QuartzPlugin {
  /** Namespaces everything this plugin registers. Unique across plugins. */
  id: string
  name: string
  /**
   * Called once, at start-up. Anything registered here is undone by the
   * teardown the host holds, so a plugin does not have to unregister its own
   * contributions — only whatever else it started, returned from here.
   */
  setup(q: Quartz): void | (() => void)
}

export interface NoteRef {
  path: string
  title: string
  /** The containing folder, or '' at the root. */
  folder: string
  mtime: number
  size: number
}

/** What `useVault` re-renders on. */
export interface VaultSnapshot {
  notes: NoteRef[]
  /** The open note, or undefined. */
  current: string | undefined
  /** The open note's text, unsaved keystrokes included. */
  text: string
  tags: TagSummary[]
}

export interface VaultApi {
  /** Every markdown note in the open vault. Attachments are not notes. */
  notes(): NoteRef[]
  current(): string | undefined
  read(path: string): Promise<string>
  /** A note's frontmatter, or an empty list when it has none. */
  frontmatter(path: string): Promise<Property[]>
  tags(): TagSummary[]
  /** The notes carrying a tag, matched the way the tag list matches. */
  taggedWith(tag: string): string[]
  /** What links to the open note. */
  backlinks(): Backlink[]
  /** Full text, answered by the server when there is one and locally when not. */
  search(query: string): Promise<SearchHit[]>
  open(path: string): Promise<void>
  /** Creates a note and opens it. The path is made unique if it has to be. */
  create(title: string, folder?: string): Promise<string>
  /**
   * Replaces a note's text, by opening it and saving over it.
   *
   * Through the editor deliberately: that is the one path that knows about the
   * pending queue, the save debounce and the conflict rules, and a second way
   * to write would be a second set of those bugs. The cost is that writing a
   * note opens it, which for everything worth writing from a plugin is what
   * you wanted anyway.
   */
  write(path: string, text: string): Promise<void>
  /** Runs `fn` whenever the notes, the tags or the open note change. */
  subscribe(fn: () => void): () => void
  /** React: the above three, as state. */
  useVault(): VaultSnapshot
}

export interface CommandApi {
  /**
   * Adds a command to ⌘P's `>` list. The id is namespaced by the plugin's,
   * so two plugins may both call theirs `today`.
   */
  add(command: { id: string; title: string; when?: () => boolean; run(): void | Promise<void> }): void
}

export interface UiApi {
  /** A block under the note list. Collapsed until it is opened. */
  sidebarSection(section: { id: string; title: string; order?: number; render: () => ReactNode }): void
  /** A small piece of the status bar, beside the sync light. */
  statusItem(item: { id: string; order?: number; render: () => ReactNode }): void
  /** A strip under the editor, beside the backlinks. Nothing when no note is open. */
  notePanel(panel: { id: string; order?: number; render: (path: string) => ReactNode }): void
  notify(kind: 'info' | 'error', text: string): void
  ask: {
    text(options: { title: string; label: string; value?: string; confirmLabel?: string }): Promise<string | null>
    confirm(options: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>
    menu(title: string, items: MenuItem[]): Promise<MenuItem | null>
  }
}
