import type { FileMeta } from '../vault/types'

export function isNote(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

export function isPdf(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

/**
 * The image types the app will put on screen.
 *
 * Exactly the set the editor inlines, so a `.webp` filed beside a `.png` is
 * not mysteriously an attachment while its neighbour is a file. One list, kept
 * here, because the editor and the note list have to agree about it.
 */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.test(path)
}

/**
 * What the app will put on screen, and so what the note list, the tree and ⌘P
 * offer: notes, and the PDFs and images sitting beside them.
 *
 * Images were an attachment for a long time — something belonging to the note
 * that embeds it rather than to the list. That was wrong for the same reason
 * it was wrong for PDFs: a vault holds maps, scans and photographs that no
 * note happens to embed, and a file the app can display but will not list is a
 * file you have to leave for Obsidian. The tree lists what can be opened, and
 * that is now the rule with no exception to remember.
 *
 * The cost is that the screenshots `attach()` writes land in the list too,
 * under `attachments/` — one folder, and closing it is remembered per vault.
 *
 * What is left over — an Obsidian settings file, a `.zip` — still belongs to
 * the note that references it.
 */
export function isOpenable(path: string): boolean {
  return isNote(path) || isPdf(path) || isImage(path)
}

/**
 * Which of the panes a file opens in, and which icon the list gives it.
 *
 * `other` is a file the app can store and sync but not display; it is not
 * listed, and is reachable only by following a link that names it.
 */
export type FileKind = 'note' | 'pdf' | 'image' | 'other'

export function fileKind(path: string): FileKind {
  if (isNote(path)) return 'note'
  if (isPdf(path)) return 'pdf'
  if (isImage(path)) return 'image'
  return 'other'
}

/**
 * The type a file's bytes should be handed over as.
 *
 * A blob with no type is fine for an `<img>`, which sniffs, and useless for a
 * PDF: a frame or a download needs to be told what it is holding.
 */
export function mimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'application/pdf'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    case 'avif':
      return 'image/avif'
    case 'bmp':
      return 'image/bmp'
    case 'md':
      return 'text/markdown; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

/** A file size as a person would say it. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** A note's name, without its extension. Anything else keeps its own: `carta.pdf` is the name. */
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
 * The rules are Obsidian's — an exact path first, then any file whose name
 * matches, case-insensitively — and they live here once. Backlinks resolve
 * every link in the vault at once, which is why the lookup tables are built
 * ahead of the questions rather than scanned per link.
 *
 * A target with no extension is a note: `[[Pi setup]]` is `Pi setup.md`. One
 * that carries its own is tried as a note first and then as the file it says
 * it is, so `![[carta.pdf]]` finds the handout wherever it is filed.
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
    const literal = cleaned.toLowerCase()
    return (
      byPath.get(lower) ??
      byName.get(basename(lower)) ??
      // A file that is not a note carries its own extension: `[[carta.pdf]]`
      // means carta.pdf, and looking for carta.pdf.md finds nothing. Tried
      // last, so a note keeps winning a name it could plausibly answer to.
      byPath.get(literal) ??
      byName.get(basename(literal))
    )
  }
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
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
