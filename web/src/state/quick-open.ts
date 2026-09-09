/**
 * The switcher behind ⌘P: type a few letters of a note's name and open it.
 *
 * Fuzzy, over the whole path, so `mbacero` finds
 * `campaigns/marea-baja/objects/acero-del-manantial.md` — in a vault four
 * folders deep, the path is most of what you remember. This is a switcher, not
 * a search: it never opens a file to look inside it, which is what keeps it
 * instant and what keeps it different from the box in the sidebar.
 *
 * It offers PDFs and images as well as notes, since a handout or a map is
 * looked up by its name in exactly the same way. Nothing here reads what is
 * inside any of them.
 */

import type { FileMeta } from '../vault/types'
import { fileKind, folderOf, isOpenable, noteTitle, type FileKind } from './notes'

export interface QuickHit {
  path: string
  title: string
  folder: string
  kind: FileKind
  /** Offsets into `path` that the query matched, for highlighting. */
  matches: number[]
}

const DEFAULT_LIMIT = 40

/**
 * The notes matching `query`, best first. An empty query lists what was
 * touched most recently, which is nearly always where you were going.
 */
export function rankNotes(query: string, files: FileMeta[], limit = DEFAULT_LIMIT): QuickHit[] {
  const notes = files.filter((f) => isOpenable(f.path))
  // Whitespace is not a separator, it is noise: "marea baja" should find
  // "marea-baja" without anyone thinking about it.
  const needle = query.toLowerCase().replace(/\s+/g, '')

  if (needle === '') {
    return [...notes]
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((file) => hit(file.path, []))
  }

  const scored: { hit: QuickHit; score: number }[] = []
  for (const file of notes) {
    const found = best(needle, file.path)
    if (!found) continue
    scored.push({ hit: hit(file.path, found.matches), score: found.score })
  }

  return scored
    .sort((a, b) => b.score - a.score || a.hit.path.localeCompare(b.hit.path))
    .slice(0, limit)
    .map((s) => s.hit)
}

function hit(path: string, matches: number[]): QuickHit {
  return { path, title: noteTitle(path), folder: folderOf(path), kind: fileKind(path), matches }
}

/** What a note scores: the better of matching its name and matching its path. */
const NAME_BONUS = 10

function best(needle: string, path: string): Match | undefined {
  const target = path.toLowerCase()
  const nameStart = target.lastIndexOf('/') + 1

  // Matching is greedy, so the first "o" of `objects/ossian.md` would be spent
  // on the folder and the name would score as scattered letters. Scoring the
  // name on its own as well is what stops a note losing to its own folder.
  const name = match(needle, target.slice(nameStart))
  const whole = match(needle, target)
  const named = name && {
    score: name.score + NAME_BONUS,
    matches: name.matches.map((i) => i + nameStart),
  }
  if (!named) return whole
  if (!whole) return named
  return named.score >= whole.score ? named : whole
}

interface Match {
  score: number
  matches: number[]
}

/**
 * Greedy subsequence matching, with the two bonuses that decide the order: a
 * run of characters together, and a character that starts a word.
 */
function match(needle: string, target: string): Match | undefined {
  const matches: number[] = []
  let score = 0
  let previous = -2
  let at = 0

  for (let i = 0; i < target.length && at < needle.length; i++) {
    if (target[i] !== needle[at]) continue
    matches.push(i)
    score += 1
    if (i === previous + 1) score += 5
    if (i === 0 || /[/\-_ .]/.test(target[i - 1])) score += 4
    previous = i
    at++
  }
  if (at < needle.length) return undefined

  // All else equal, the shorter target is the one meant.
  return { score: score - target.length * 0.02, matches }
}
