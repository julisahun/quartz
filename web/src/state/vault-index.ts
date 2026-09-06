/**
 * What the app knows about the vault beyond the file list: who links to whom,
 * and which notes carry which tags.
 *
 * Both come from one scan. Parsing is incremental — a note is re-read only
 * when its hash moves — so a sync that touched one file costs one read, and
 * asking for tags on top of backlinks costs nothing extra. Resolution is redone
 * every time, because a link's target depends on which notes exist: creating
 * `Pi setup.md` turns every `[[Pi setup]]` written before it into a real link.
 */

import { decodeText, type FileMeta } from '../vault/types'
import { parseLinks, type Backlink, type LinkRef } from './links'
import { buildResolver, isNote, noteTitle } from './notes'
import { parseTags, tagKey, tagMatches, type TagRef } from './tags'

/** A tag and the notes carrying it, for the sidebar. */
export interface TagSummary {
  /** The tag as it was first written — `#PNJ` stays `#PNJ` in the list. */
  tag: string
  /** Lower-cased, which is how tags are compared. */
  key: string
  /** Every note carrying it, sorted by title. */
  paths: string[]
}

interface Parsed {
  hash: string
  links: LinkRef[]
  tags: TagRef[]
}

export class VaultIndex {
  private parsed = new Map<string, Parsed>()
  private backlinks = new Map<string, Backlink[]>()
  private tags: TagSummary[] = []

  async rebuild(files: FileMeta[], read: (path: string) => Promise<Uint8Array>): Promise<void> {
    const notes = files.filter((f) => isNote(f.path))
    const live = new Set<string>()

    for (const note of notes) {
      live.add(note.path)
      if (this.parsed.get(note.path)?.hash === note.hash) continue
      let entry: Parsed = { hash: note.hash, links: [], tags: [] }
      try {
        const text = decodeText(await read(note.path))
        entry = { hash: note.hash, links: parseLinks(text), tags: parseTags(text) }
      } catch {
        // Listed but not readable — evicted, or deleted mid-scan. It links to
        // nothing until it comes back, which beats failing the whole rebuild.
      }
      this.parsed.set(note.path, entry)
    }

    for (const path of [...this.parsed.keys()]) {
      if (!live.has(path)) this.parsed.delete(path)
    }
    this.resolve(files)
    this.collectTags()
  }

  /** Every note linking to `path`, by title then by where the link appears. */
  to(path: string): Backlink[] {
    return this.backlinks.get(path) ?? []
  }

  /** Every tag in the vault, by name. */
  allTags(): TagSummary[] {
    return this.tags
  }

  /** The notes carrying `tag` or anything nested under it. */
  taggedWith(tag: string): string[] {
    const paths = new Set<string>()
    for (const summary of this.tags) {
      if (!tagMatches(summary.tag, tag)) continue
      for (const path of summary.paths) paths.add(path)
    }
    return [...paths]
  }

  private resolve(files: FileMeta[]): void {
    const resolve = buildResolver(files)
    const map = new Map<string, Backlink[]>()

    for (const [from, { links }] of this.parsed) {
      for (const ref of links) {
        const target = resolve(ref.target)
        // A link to an attachment is not a mention of a note, and a note that
        // links to itself has not been mentioned anywhere else.
        if (!target || target === from || !isNote(target)) continue

        const list = map.get(target) ?? []
        // Two links to the same note on one line are one mention of it.
        if (list.some((b) => b.path === from && b.line === ref.line)) continue
        list.push({ path: from, title: noteTitle(from), line: ref.line, context: ref.context })
        map.set(target, list)
      }
    }

    for (const list of map.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title) || a.line - b.line)
    }
    this.backlinks = map
  }

  private collectTags(): void {
    const byKey = new Map<string, TagSummary>()

    for (const [path, { tags }] of this.parsed) {
      for (const ref of tags) {
        const key = tagKey(ref.tag)
        // First spelling seen wins, so the list does not flicker between
        // `#PNJ` and `#pnj` as notes are re-read.
        const summary = byKey.get(key) ?? { tag: ref.tag, key, paths: [] }
        if (!summary.paths.includes(path)) summary.paths.push(path)
        byKey.set(key, summary)
      }
    }

    for (const summary of byKey.values()) {
      summary.paths.sort((a, b) => noteTitle(a).localeCompare(noteTitle(b)))
    }
    this.tags = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
  }
}

/**
 * Whether two backlink lists say the same thing.
 *
 * Every rebuild produces fresh arrays, and a rebuild happens on each autosave —
 * without this the panel would re-render every half second of typing.
 */
export function sameBacklinks(a: Backlink[], b: Backlink[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]
      return x.path === y.path && x.line === y.line && x.context === y.context
    })
  )
}

/** The same question for the tag list, and for the same reason. */
export function sameTags(a: TagSummary[], b: TagSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]
      return x.key === y.key && x.paths.length === y.paths.length && x.paths.every((p, j) => p === y.paths[j])
    })
  )
}
