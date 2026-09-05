import type { FileMeta } from '../vault/types'

export function isNote(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

export function noteTitle(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.replace(/\.md$/i, '')
}

export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function isConflictCopy(path: string): boolean {
  return / \(conflict [^)]+\)\.[^.]+$/.test(path)
}

/**
 * Resolves a [[wikilink]] against the vault the way Obsidian does: an exact
 * path first, then any note whose name matches, case-insensitively.
 */
export function resolveWikilink(target: string, files: FileMeta[]): string | undefined {
  const cleaned = target.split('#')[0].split('|')[0].trim()
  if (!cleaned) return undefined

  const withExt = cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`
  const paths = files.map((f) => f.path)

  const exact = paths.find((p) => p === withExt || p === cleaned)
  if (exact) return exact

  const lower = withExt.toLowerCase()
  const byPath = paths.find((p) => p.toLowerCase() === lower)
  if (byPath) return byPath

  const name = lower.slice(lower.lastIndexOf('/') + 1)
  return paths.find((p) => p.toLowerCase().slice(p.lastIndexOf('/') + 1) === name)
}

/** The path a new note takes, avoiding a collision with an existing one. */
export function uniquePath(desired: string, files: FileMeta[]): string {
  const taken = new Set(files.map((f) => f.path.toLowerCase()))
  if (!taken.has(desired.toLowerCase())) return desired

  const dot = desired.lastIndexOf('.')
  const base = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  for (let i = 2; i < 500; i++) {
    const candidate = `${base} ${i}${ext}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${base} ${Date.now()}${ext}`
}

/** Slugifies a title into a vault path. Kept close to what a person would type. */
export function pathForTitle(title: string, folder = ''): string {
  const clean = title
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const name = clean === '' ? 'Untitled' : clean
  return `${folder ? `${folder}/` : ''}${name}.md`
}
