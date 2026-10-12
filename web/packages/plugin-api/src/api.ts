import type { ReactNode } from 'react'

/**
 * The vocabulary of the contract.
 *
 * These five shapes are declared here rather than imported from the app, so
 * that installing this package brings nothing of Quartz's internals with it.
 * The app keeps its own definitions where they belong — `Backlink` next to the
 * link scanner, `SearchHit` next to the client — and `contract.test.ts` there
 * fails to compile if either side drifts from the other.
 */

/** One frontmatter entry. */
export interface Property {
  key: string
  /** A single value, or the items of a list. */
  value: string | string[]
}

/** A note that links to the open one. */
export interface Backlink {
  /** The note the link is written in. */
  path: string
  title: string
  line: number
  context: string
}

export interface TagSummary {
  /** The tag as it was first written — `#PNJ` stays `#PNJ` in the list. */
  tag: string
  /** Lower-cased, which is how tags are compared. */
  key: string
  /** Every note carrying it, sorted by title. */
  paths: string[]
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
}

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  run: () => void
}

/**
 * What a plugin is handed, and all it is meant to need.
 *
 * Plugins are compiled into the app, so none of this is enforced at runtime —
 * but it is enforced: the app's `boundary.test.ts` fails if a plugin imports
 * anything but this package. It used to be a convention on the grounds that
 * whoever wrote a plugin also wrote `state/store.ts`, which is no longer a
 * safe thing to assume. Everything reached through here is the part promised
 * to keep working; anything else is a plugin holding the app's internals, and
 * it breaks when they move.
 */
export interface Quartz {
  vault: VaultApi
  commands: CommandApi
  ui: UiApi
  home: HomeApi
}

export interface QuartzPlugin {
  /** Namespaces everything this plugin registers. Unique across plugins. */
  id: string
  name: string
  /** One line, in the marketplace, of what turning this on does. */
  description: string
  /**
   * Who wrote it. Everything bundled says "Quartz", and the field exists so a
   * row that came from somewhere else could say so instead.
   */
  author?: string
  /** Shown beside the name. Bundled plugins move with the app's version. */
  version?: string
  /** A character or two for the marketplace tile. Defaults to the initial. */
  icon?: string
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

export interface Command {
  /** Namespaced by the plugin's id, so two plugins may both call theirs `today`. */
  id: string
  title: string
  /** Only offered while this says so — "rename" wants a note open. */
  when?: () => boolean
  run(): void | Promise<void>
}

export interface CommandApi {
  /**
   * Adds a command to ⌘P's `>` list. The id is namespaced by the plugin's,
   * so two plugins may both call theirs `today`.
   */
  add(command: Command): void
}

export interface HomeApi {
  /**
   * Offers a home: the note a vault opens on at launch, worked out each time.
   *
   * A plugin's first home becomes the vault's home the first time it is
   * offered there; any others it offers are alternatives, picked in Settings.
   * After that the person's own choice wins, and turning this plugin off
   * takes its homes away. `resolve` answers a note's path — it may create
   * the note, and is only asked once the launch's first sync is over — or
   * `{ view }`, one of this plugin's views, by the id it was registered with.
   */
  provide(home: {
    id: string
    label: string
    resolve: () => Promise<string | { view: string } | undefined>
  }): void
}

export interface UiApi {
  /** A block under the note list. Collapsed until it is opened. */
  sidebarSection(section: { id: string; title: string; order?: number; render: () => ReactNode }): void
  /** A small piece of the status bar, beside the sync light. */
  statusItem(item: { id: string; order?: number; render: () => ReactNode }): void
  /** A strip under the editor, beside the backlinks. Nothing when no note is open. */
  notePanel(panel: { id: string; order?: number; render: (path: string) => ReactNode }): void
  /**
   * A screen in the main pane, in place of the note. On a phone it is a
   * screen of its own, with a way back to the list. Opening a note closes it.
   */
  view(view: { id: string; title: string; render: () => ReactNode }): void
  /** Shows one of this plugin's views, by the id it was registered with. */
  openView(id: string): void
  /**
   * An icon button in the sidebar's header, beside search, that opens one of
   * this plugin's views — and shows itself pressed while that view is open.
   * The icon is drawn on `currentColor`, about 18px.
   */
  sidebarButton(button: { id: string; label: string; icon: () => ReactNode; view: string; order?: number }): void
  /**
   * Leaves paths out of the note tree. Only the tree: search, ⌘P and links
   * still find them, so they are tidied away rather than lost.
   */
  hideFromTree(hide: (path: string) => boolean): void
  notify(kind: 'info' | 'error', text: string): void
  ask: {
    text(options: { title: string; label: string; value?: string; confirmLabel?: string }): Promise<string | null>
    confirm(options: { title: string; body?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean>
    menu(title: string, items: MenuItem[]): Promise<MenuItem | null>
  }
}
