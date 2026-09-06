/**
 * A note's YAML frontmatter, as far as the app needs to understand it.
 *
 * Obsidian writes properties into a `---` block at the top of a note, so the
 * vault is full of them and the editor has to do something better than showing
 * them as body text — which is what they were, before this: `---` parsed as a
 * horizontal rule and the YAML underneath as a paragraph.
 *
 * This is deliberately a subset, not a YAML parser. Scalars, lists, inline
 * `[a, b]` lists and block scalars (`>-`, `|`) cover everything Obsidian
 * writes; anything else is kept as the lines it was written on and shown that
 * way. Guessing at the rest would be worse than being honest about it.
 */

export interface Property {
  key: string
  /** A single value, or the items of a list. */
  value: string | string[]
}

const FENCE = /^(-{3}|\.{3})[ \t]*\r?$/

/** A top-level `key:` — no indentation, so list items and nested maps miss it. */
const KEY = /^([^\s:#][^:]*):(?:[ \t]+(.*))?[ \t]*$/
const BLOCK_SCALAR = /^([|>])[-+]?\d*$/
const LIST_ITEM = /^[ \t]+-(?:[ \t]+(.*))?[ \t]*$/

/** Whether a line is one of the `---` fences a frontmatter block sits between. */
export function isFrontmatterFence(line: string): boolean {
  return FENCE.test(line)
}

/**
 * Where the frontmatter block sits, or undefined if there is none.
 *
 * A block only counts once it is closed. While the closing `---` is still
 * being typed the note is just a note that starts with a rule, which is what
 * it looks like in Obsidian too.
 */
export function frontmatterRange(text: string): { from: number; to: number } | undefined {
  if (!text.startsWith('---')) return undefined
  const lines = text.split('\n')
  if (!FENCE.test(lines[0])) return undefined

  let at = lines[0].length + 1
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i])) return { from: 0, to: at + lines[i].length }
    at += lines[i].length + 1
  }
  return undefined
}

/** The properties of a note, in the order they were written. Empty when there are none. */
export function parseFrontmatter(text: string): Property[] {
  const range = frontmatterRange(text)
  if (!range) return []
  const lines = text
    .slice(0, range.to)
    .split('\n')
    .slice(1, -1)
    .map((line) => line.replace(/\r$/, ''))
  return parseBody(lines)
}

function parseBody(lines: string[]): Property[] {
  const props: Property[] = []
  let i = 0

  while (i < lines.length) {
    const match = KEY.exec(lines[i])
    if (!match) {
      i++
      continue
    }
    const key = match[1].trim()
    const rest = (match[2] ?? '').trim()
    i++

    const scalar = BLOCK_SCALAR.exec(rest)
    if (scalar) {
      const block = readIndented(lines, i)
      props.push({ key, value: join(block.lines, scalar[1] === '>') })
      i = block.next
      continue
    }
    if (rest === '') {
      if (LIST_ITEM.test(lines[i] ?? '')) {
        const list = readList(lines, i)
        props.push({ key, value: list.items })
        i = list.next
        continue
      }
      const block = readIndented(lines, i)
      // A nested map, or nothing at all. Shown as written rather than guessed at.
      props.push({ key, value: block.lines.length ? join(block.lines, false) : '' })
      i = block.next
      continue
    }
    props.push({ key, value: inlineValue(rest) })
  }

  return props
}

/**
 * The indented run under a key or a list item, dedented to its own margin.
 * `least` is the indent a line has to reach to belong to it, which is what
 * stops one list item swallowing the next.
 */
function readIndented(lines: string[], from: number, least = 1): { lines: string[]; next: number } {
  const out: string[] = []
  let i = from
  while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) >= least)) {
    out.push(lines[i])
    i++
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  const indent = Math.min(
    ...out.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
  )
  return { lines: out.map((l) => l.slice(indent)), next: i }
}

/**
 * A `- item` list, including items that are themselves block scalars — which
 * is how Obsidian wraps a long line, and so how most of them are written.
 */
function readList(lines: string[], from: number): { items: string[]; next: number } {
  const items: string[] = []
  let i = from

  while (i < lines.length) {
    const item = LIST_ITEM.exec(lines[i])
    if (!item) break
    const head = (item[1] ?? '').trim()
    i++
    // Continuations belong to this item only while they stay clear of the
    // next "-", which sits at the marker's own indent.
    const inner = indentOf(lines[i - 1]) + 1
    const scalar = BLOCK_SCALAR.exec(head)
    const block = readIndented(lines, i, inner)
    if (scalar || head === '') {
      items.push(join(block.lines, scalar ? scalar[1] === '>' : true))
    } else {
      // A plain scalar can still run over, indented, onto the next lines.
      items.push(join([unquote(head), ...block.lines], true))
    }
    i = block.next
  }

  return { items, next: i }
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

function join(lines: string[], folded: boolean): string {
  const kept = [...lines]
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
  return folded ? kept.map((l) => l.trim()).filter(Boolean).join(' ') : kept.join('\n')
}

function inlineValue(rest: string): string | string[] {
  if (rest.startsWith('[') && rest.endsWith(']')) {
    return splitList(rest.slice(1, -1))
  }
  return unquote(rest)
}

/** `a, "b, still b", c` — commas separate, except inside quotes. */
function splitList(body: string): string[] {
  const items: string[] = []
  let current = ''
  let quote = ''
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = ''
      else current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === ',') {
      items.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  items.push(current.trim())
  return items.filter((item) => item !== '')
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed)
  return quoted ? quoted[2] : trimmed
}

/**
 * The tags a note declares in its frontmatter. `tags: [a, b]`, a `- ` list and
 * `tags: a, b` all mean the same thing, with or without the `#`.
 */
export function frontmatterTags(props: Property[]): string[] {
  const out: string[] = []
  for (const prop of props) {
    const key = prop.key.toLowerCase()
    if (key !== 'tags' && key !== 'tag') continue
    const raw = Array.isArray(prop.value) ? prop.value : prop.value.split(/[,\s]+/)
    for (const item of raw) {
      const tag = item.trim().replace(/^#/, '')
      if (tag) out.push(tag)
    }
  }
  return out
}
