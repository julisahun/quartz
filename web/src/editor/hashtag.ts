import type { InlineContext, MarkdownConfig } from '@lezer/markdown'
import { Tag } from '@lezer/highlight'
import { isTagBody, isTagChar } from '../state/tags'

export const hashtagTag = Tag.define()

const HASH = 35 // #

/**
 * Teaches the markdown parser about `#tags`.
 *
 * A real node rather than a scan of the document, for the same reason
 * `[[wikilinks]]` are: live preview then treats a tag like every other
 * construct, and a `#tag` inside a code fence or a backtick span is never seen
 * at all, because inline parsing does not run there.
 *
 * The rules match `state/tags.ts`, which is what the vault index scans with —
 * a tag the editor styles and the sidebar cannot find would be worse than no
 * styling at all.
 */
export const Hashtag: MarkdownConfig = {
  defineNodes: [{ name: 'Hashtag', style: hashtagTag }],
  parseInline: [
    {
      name: 'Hashtag',
      parse(cx: InlineContext, next: number, pos: number): number {
        if (next !== HASH) return -1
        // Start of the line, or after whitespace. This is what keeps the
        // fragment of `https://host/#anchor` and `[text](#heading)` out.
        if (pos > cx.offset && !/\s/.test(String.fromCharCode(cx.char(pos - 1)))) return -1

        let end = pos + 1
        while (end < cx.end && isTagChar(String.fromCharCode(cx.char(end)))) end++
        if (!isTagBody(cx.slice(pos + 1, end))) return -1

        return cx.addElement(cx.elt('Hashtag', pos, end))
      },
    },
  ],
}
