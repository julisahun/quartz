import type { InlineContext, MarkdownConfig } from '@lezer/markdown'
import { Tag } from '@lezer/highlight'

export const wikilinkTag = Tag.define()

const BANG = 33 // !
const OPEN = 91 // [
const CLOSE = 93 // ]

/**
 * Teaches the markdown parser about `[[note]]` and `![[image.png]]`.
 *
 * Parsing them into real nodes (rather than scanning the document with a
 * regular expression) means the live-preview decorator treats them exactly
 * like every other construct, and they nest correctly inside emphasis,
 * list items and quotes.
 */
export const Wikilink: MarkdownConfig = {
  defineNodes: [
    { name: 'Wikilink', style: wikilinkTag },
    { name: 'WikilinkMark' },
    { name: 'WikilinkTarget' },
    { name: 'WikilinkEmbed', style: wikilinkTag },
  ],
  parseInline: [
    {
      name: 'Wikilink',
      before: 'Link',
      parse(cx: InlineContext, next: number, pos: number): number {
        const embed = next === BANG && cx.char(pos + 1) === OPEN && cx.char(pos + 2) === OPEN
        const open = embed ? pos + 1 : pos
        if (!embed && !(next === OPEN && cx.char(pos + 1) === OPEN)) return -1

        let end = -1
        for (let i = open + 2; i < cx.end - 1; i++) {
          const ch = cx.char(i)
          if (ch === CLOSE && cx.char(i + 1) === CLOSE) {
            end = i
            break
          }
          // A wikilink never spans a line, and never contains a bare "[".
          if (ch === 10 || ch === OPEN) return -1
        }
        if (end < 0 || end === open + 2) return -1

        const marks = [
          cx.elt('WikilinkMark', open, open + 2),
          cx.elt('WikilinkTarget', open + 2, end),
          cx.elt('WikilinkMark', end, end + 2),
        ]
        const node = embed
          ? cx.elt('WikilinkEmbed', pos, end + 2, [cx.elt('WikilinkMark', pos, pos + 1), ...marks])
          : cx.elt('Wikilink', open, end + 2, marks)
        return cx.addElement(node)
      },
    },
  ],
}

/** Splits `target|display#heading` into its parts. */
export function parseWikilinkTarget(raw: string): { target: string; display?: string } {
  const [linkPart, ...rest] = raw.split('|')
  return {
    target: linkPart.trim(),
    display: rest.length ? rest.join('|').trim() : undefined,
  }
}
