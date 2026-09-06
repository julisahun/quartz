/**
 * `#tags`, as Obsidian writes them: inline in the body, and in the
 * frontmatter's `tags:` property.
 *
 * The rule for an inline tag is Obsidian's — it starts at the beginning of a
 * line or after whitespace, so `https://host/#anchor` and `[text](#heading)`
 * are not tags — and a tag of nothing but digits is not one either, which is
 * what keeps `#1` in "issue #1" out of the index.
 */

import { frontmatterRange, frontmatterTags, parseFrontmatter } from './frontmatter'
import { scan } from './links'

/** A tag as written, and where. */
export interface TagRef {
  tag: string
  /** 1-based line, or 1 for a tag that came from the frontmatter. */
  line: number
}

/**
 * The characters a tag body is made of. Unicode letters, so `#sequía` and
 * `#日記` are tags, and `/` so a tag can nest.
 *
 * Written without a lookbehind on purpose: Safari only learned those in 16.4,
 * and this app runs on phones older than that.
 */
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu
const TAG_CHAR = /[\p{L}\p{N}_/-]/u
const ALL_DIGITS = /^[\p{N}/-]+$/u

/** Whether a character may appear in a tag body. Shared with the editor's parser. */
export function isTagChar(char: string): boolean {
  return TAG_CHAR.test(char)
}

/** Whether a run of tag characters is actually a tag, and not `#1`. */
export function isTagBody(body: string): boolean {
  return body.length > 0 && !ALL_DIGITS.test(body)
}

/** Tags are matched case-insensitively, and displayed as they were written. */
export function tagKey(tag: string): string {
  return tag.toLowerCase()
}

/** Whether `tag` is `filter` or nests under it — `#pnj/roquena` is inside `#pnj`. */
export function tagMatches(tag: string, filter: string): boolean {
  const key = tagKey(tag)
  const under = tagKey(filter)
  return key === under || key.startsWith(`${under}/`)
}

/**
 * Every tag in a note. Code is skipped — a `#tag` inside a fence is a worked
 * example — and so is the frontmatter block, whose `#` characters belong to
 * YAML rather than to prose. Its declared tags are read properly instead.
 */
export function parseTags(text: string): TagRef[] {
  const refs: TagRef[] = []
  for (const tag of frontmatterTags(parseFrontmatter(text))) {
    if (isTagBody(tag)) refs.push({ tag, line: 1 })
  }

  const range = frontmatterRange(text)
  const skip = range ? text.slice(0, range.to).split('\n').length : 0

  scan(text).forEach(({ scannable }, i) => {
    if (i < skip || scannable === undefined) return
    TAG.lastIndex = 0
    for (let m = TAG.exec(scannable); m; m = TAG.exec(scannable)) {
      if (isTagBody(m[2])) refs.push({ tag: m[2], line: i + 1 })
    }
  })

  return refs
}
