/**
 * Reading and rewriting the `[[links]]` in a note's source.
 *
 * Links are read on the client, from the local vault, rather than on the
 * server. Every note is already on the device — that is what makes editing
 * work offline — and resolving a `[[link]]` has exactly one implementation
 * (`buildResolver`), shared with the editor. A server-side link table would
 * need a second copy of those rules in Go, and a backlink that disagreed with
 * the link you clicked would open the wrong note.
 *
 * What is done with them afterwards is `VaultIndex`, in `vault-index.ts`.
 */

/** A `[[link]]` as written, before it is resolved against the vault. */
export interface LinkRef {
  /** The raw target, `display` and `#heading` included. */
  target: string
  /** 1-based line the link sits on. */
  line: number
  /** That line, trimmed — enough to see why the link is there. */
  context: string
}

/** A resolved link, seen from the note being pointed at. */
export interface Backlink {
  /** The note the link is written in. */
  path: string
  title: string
  line: number
  context: string
}

const WIKILINK = /!?\[\[([^[\]\n]+)]]/g
const FENCE = /^\s{0,3}(`{3,}|~{3,})/
const INLINE_CODE = /`[^`\n]*`/g
const CONTEXT_MAX = 200

/**
 * Finds every wikilink in a note's source.
 *
 * A regular expression rather than the markdown parser: this runs over the
 * whole vault after a sync, where standing up a CodeMirror parse per note
 * would be pointless. Code is skipped, though — `[[not a link]]` inside a
 * fence or a backtick span is a worked example, not a reference.
 */
export function parseLinks(text: string): LinkRef[] {
  const refs: LinkRef[] = []
  scan(text).forEach(({ line, scannable }, i) => {
    if (scannable === undefined) return
    WIKILINK.lastIndex = 0
    for (let m = WIKILINK.exec(scannable); m; m = WIKILINK.exec(scannable)) {
      refs.push({ target: m[1], line: i + 1, context: context(line) })
    }
  })
  return refs
}

interface ScannedLine {
  line: string
  /**
   * The line with its code spans blanked out, or undefined when the whole line
   * is code. Blanking keeps the length, so an offset into it is an offset into
   * the line itself.
   */
  scannable: string | undefined
}

/**
 * Splits a note into lines and marks which of them are code.
 *
 * Reading links, rewriting them and collecting tags all share this, so no two
 * of them can disagree about whether something inside a fence counts.
 */
export function scan(text: string): ScannedLine[] {
  const out: ScannedLine[] = []
  let fence = ''

  for (const line of text.split('\n')) {
    const fenced = FENCE.exec(line)
    if (fenced) {
      const marker = fenced[1]
      // A fence closes only on its own character, and never on a shorter run.
      if (fence === '') fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      out.push({ line, scannable: undefined })
      continue
    }
    const code = fence !== ''
    out.push({
      line,
      scannable: code ? undefined : line.replace(INLINE_CODE, (span) => ' '.repeat(span.length)),
    })
  }

  return out
}

function context(line: string): string {
  const trimmed = line.trim()
  return trimmed.length > CONTEXT_MAX ? `${trimmed.slice(0, CONTEXT_MAX)}…` : trimmed
}

export interface Retarget {
  /** Resolves a raw link target against the vault as it stood before the rename. */
  resolve: (target: string) => string | undefined
  /** The note being renamed. */
  from: string
  /** Where it is going. */
  to: string
  /** Whether `[[Basename]]` on its own still lands on `to` once the rename is done. */
  shortNameWorks: boolean
}

/**
 * Points every link to `from` at `to`, and leaves the rest of the note alone.
 *
 * Each link keeps the shape it was written in — a bare name stays a bare name,
 * a path stays a path — because a rename should read as a change of name, not
 * as someone reformatting your prose. `#headings`, `|display text` and the `!`
 * of an embed all survive, and code is skipped exactly as it is when links are
 * read.
 */
export function retargetLinks(text: string, opts: Retarget): { text: string; changed: number } {
  let changed = 0

  const lines = scan(text).map(({ line, scannable }) => {
    if (scannable === undefined) return line

    let out = ''
    let last = 0
    WIKILINK.lastIndex = 0
    for (let m = WIKILINK.exec(scannable); m; m = WIKILINK.exec(scannable)) {
      if (opts.resolve(m[1]) !== opts.from) continue
      out += line.slice(last, m.index) + rewrite(m[0], m[1], opts)
      last = m.index + m[0].length
      changed++
    }
    return out + line.slice(last)
  })

  return { text: lines.join('\n'), changed }
}

function rewrite(whole: string, raw: string, opts: Retarget): string {
  const bang = whole.startsWith('!') ? '!' : ''
  const pipe = raw.indexOf('|')
  const linkPart = pipe < 0 ? raw : raw.slice(0, pipe)
  // The display text is the author's own words; only the target is ours.
  const display = pipe < 0 ? '' : raw.slice(pipe)
  const hash = linkPart.indexOf('#')
  const written = (hash < 0 ? linkPart : linkPart.slice(0, hash)).trim()
  const heading = hash < 0 ? '' : linkPart.slice(hash)

  return `${bang}[[${shaped(written, opts)}${heading}${display}]]`
}

/**
 * The new target, written the way the old one was.
 *
 * A bare name is only kept while it is unambiguous: if the new name collides
 * with another note, `[[Name]]` would resolve somewhere else, so the link is
 * widened to the full path rather than quietly pointing at a stranger.
 */
function shaped(written: string, opts: Retarget): string {
  const keepExtension = /\.md$/i.test(written)
  const short = !written.includes('/') && opts.shortNameWorks
  const target = short ? opts.to.slice(opts.to.lastIndexOf('/') + 1) : opts.to
  return keepExtension ? target : target.replace(/\.md$/i, '')
}
