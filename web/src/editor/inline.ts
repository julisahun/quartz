import { isTagBody } from '../state/tags'
import { parseWikilinkTarget } from './wikilink'

/**
 * Renders a run of inline markdown into DOM, for the places live preview
 * replaces a whole block and has to draw the contents itself: table cells and
 * frontmatter values.
 *
 * The decorator cannot help there — it hides markup in place, and these are
 * widgets built from a string — so this is a second, much smaller renderer.
 * It stays deliberately small: emphasis, code, links and tags, one level of
 * nesting, and anything it does not recognise is left as the text it is. A
 * table cell that quietly dropped what it could not parse would be worse than
 * one showing a stray asterisk.
 *
 * Links and tags get the same `data-` attributes the decorator uses, so the
 * editor's one click handler follows them without knowing they came from here.
 */
const PATTERN = [
  '(\\*\\*|__)([\\s\\S]+?)\\1', // 1,2   strong
  '(\\*|_)([\\s\\S]+?)\\3', // 3,4   emphasis
  '~~([\\s\\S]+?)~~', // 5     strikethrough
  '`([^`]+)`', // 6     inline code
  '!?\\[\\[([^\\]\\n]+)\\]\\]', // 7     wikilink or embed
  '\\[([^\\]]*)\\]\\(([^)\\s]+)\\)', // 8,9   markdown link
  '(^|\\s)#([\\p{L}\\p{N}_/-]+)', // 10,11 tag
].join('|')

export function renderInline(text: string, into: HTMLElement): void {
  // A fresh matcher each time: this recurses into what it finds, and a shared
  // one would have its cursor moved out from under the outer walk.
  const inline = new RegExp(PATTERN, 'gu')
  let last = 0

  for (let m = inline.exec(text); m; m = inline.exec(text)) {
    const node = build(m)
    if (!node) continue
    if (m.index > last) into.append(text.slice(last, m.index))
    // The tag rule has to look at the character before the "#"; it is text,
    // not part of the tag.
    if (m[10]) into.append(m[10])
    into.append(node)
    last = m.index + m[0].length
  }
  if (last < text.length) into.append(text.slice(last))
}

function build(m: RegExpExecArray): Node | undefined {
  if (m[2] !== undefined) return wrap('strong', m[2])
  if (m[4] !== undefined) return wrap('em', m[4])
  if (m[5] !== undefined) return wrap('s', m[5])
  if (m[6] !== undefined) {
    const code = document.createElement('code')
    code.className = 'cm-inline-code'
    code.textContent = m[6]
    return code
  }
  if (m[7] !== undefined) {
    const { target, display } = parseWikilinkTarget(m[7])
    const span = document.createElement('span')
    span.className = 'cm-wikilink'
    span.dataset.wikilink = target
    span.title = target
    span.textContent = display ?? target
    return span
  }
  if (m[9] !== undefined) {
    const span = document.createElement('span')
    span.className = 'cm-link'
    span.dataset.href = m[9]
    span.title = m[9]
    renderInline(m[8], span)
    return span
  }
  if (m[11] !== undefined) {
    if (!isTagBody(m[11])) return undefined
    const span = document.createElement('span')
    span.className = 'cm-tag'
    span.dataset.tag = m[11]
    span.textContent = `#${m[11]}`
    return span
  }
  return undefined
}

function wrap(tag: 'strong' | 'em' | 's', inner: string): HTMLElement {
  const el = document.createElement(tag)
  renderInline(inner, el)
  return el
}
