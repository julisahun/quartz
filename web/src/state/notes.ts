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
 * Prepares the vault for repeated wikilink resolution.
 *
 * The rules are Obsidian's — an exact path first, then any note whose name
 * matches, case-insensitively — and they live here once. Backlinks resolve
 * every link in the vault at once, which is why the lookup tables are built
 * ahead of the questions rather than scanned per link.
 */
export function buildResolver(files: FileMeta[]): (target: string) => string | undefined {
  const exact = new Set<string>()
  const byPath = new Map<string, string>()
  const byName = new Map<string, string>()

  for (const file of files) {
    exact.add(file.path)
    const lower = file.path.toLowerCase()
    // First one wins, so two notes of the same name resolve the way a scan of
    // the file list in order would have.
    if (!byPath.has(lower)) byPath.set(lower, file.path)
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    if (!byName.has(name)) byName.set(name, file.path)
  }

  return (target) => {
    const cleaned = target.split('#')[0].split('|')[0].trim()
    if (!cleaned) return undefined

    const withExt = cleaned.toLowerCase().endsWith('.md') ? cleaned : `${cleaned}.md`
    if (exact.has(withExt)) return withExt
    if (exact.has(cleaned)) return cleaned

    const lower = withExt.toLowerCase()
    return byPath.get(lower) ?? byName.get(lower.slice(lower.lastIndexOf('/') + 1))
  }
}

/** Resolves one [[wikilink]] against the vault. See {@link buildResolver}. */
export function resolveWikilink(target: string, files: FileMeta[]): string | undefined {
  return buildResolver(files)(target)
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
