import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import {
  BulletWidget,
  CheckboxWidget,
  HorizontalRuleWidget,
  ImageWidget,
  TableWidget,
} from './widgets'
import { parseWikilinkTarget } from './wikilink'

export interface LivePreviewConfig {
  /** Turns a vault path into something an <img> can load, or undefined. */
  resolveAsset: (path: string) => Promise<string | undefined>
  openWikilink: (target: string) => void
  openUrl: (url: string) => void
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i

/**
 * Live preview: markup is hidden and replaced with what it means, except on
 * the line you are editing, where the raw source comes back.
 *
 * Built one construct at a time, in the order the plan sets out — headings,
 * emphasis and inline code, lists and checkboxes, links and refs, blockquotes,
 * code fences, tables. The interactions between constructs are where the time
 * goes, so each is handled explicitly rather than through one clever rule.
 */
export function livePreview(config: LivePreviewConfig): Extension {
  // A StateField rather than a ViewPlugin: block-level replacements (a table
  // rendered in place of its source) are only allowed from state. The cost is
  // decorating the whole document instead of the viewport, which for notes —
  // kilobytes, not megabytes — is not worth optimising away.
  const field = StateField.define<Built>({
    create: (state) => build(state, config),
    update: (value, tr) => (tr.docChanged || tr.selection ? build(tr.state, config) : value),
    provide: (f) => [
      EditorView.decorations.from(f, (built) => built.decorations),
      // Hidden markup is atomic, so arrow keys step over it instead of
      // stranding the cursor inside syntax that is not on screen.
      EditorView.atomicRanges.of((view) => view.state.field(f, false)?.hidden ?? Decoration.none),
    ],
  })

  return [field, clickHandler(config)]
}

interface Built {
  decorations: DecorationSet
  hidden: DecorationSet
}

function build(state: EditorState, config: LivePreviewConfig): Built {
  const decorations: Range<Decoration>[] = []
  const hiddenRanges: Range<Decoration>[] = []

  // The lines the selection touches keep their raw markup, so editing what you
  // see is always possible without a mode switch.
  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) activeLines.add(n)
  }
  const lineActive = (pos: number) => activeLines.has(state.doc.lineAt(pos).number)
  const blockActive = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.to >= from && r.from <= to)

  const hide = (from: number, to: number) => {
    if (to <= from) return
    const deco = Decoration.replace({})
    decorations.push(deco.range(from, to))
    hiddenRanges.push(deco.range(from, to))
  }
  const replace = (from: number, to: number, spec: Parameters<typeof Decoration.replace>[0]) => {
    const deco = Decoration.replace(spec)
    decorations.push(deco.range(from, to))
    hiddenRanges.push(deco.range(from, to))
  }
  const mark = (from: number, to: number, className: string, attributes?: Record<string, string>) => {
    if (to <= from) return
    decorations.push(Decoration.mark({ class: className, attributes }).range(from, to))
  }
  const lineClass = (pos: number, className: string) => {
    decorations.push(Decoration.line({ class: className }).range(state.doc.lineAt(pos).from))
  }

  syntaxTree(state).iterate({ enter: (node) => handle(node) })

  function handle(node: SyntaxNodeRef): boolean | void {
    const name = node.name
    const text = () => state.sliceDoc(node.from, node.to)

    // --- Headings ---------------------------------------------------------
    if (/^ATXHeading[1-6]$/.test(name)) {
      lineClass(node.from, `cm-heading cm-h${name.slice(-1)}`)
      return
    }
    if (/^SetextHeading[12]$/.test(name)) {
      lineClass(node.from, `cm-heading cm-h${name.slice(-1)}`)
      return
    }
    if (name === 'HeaderMark') {
      if (!lineActive(node.from)) {
        // Swallow the space after "#" too, so the text starts at the margin.
        const after = state.sliceDoc(node.to, Math.min(node.to + 1, state.doc.length))
        hide(node.from, after === ' ' ? node.to + 1 : node.to)
      }
      return
    }

    // --- Emphasis and inline code ----------------------------------------
    if (name === 'Emphasis') return void mark(node.from, node.to, 'cm-em')
    if (name === 'StrongEmphasis') return void mark(node.from, node.to, 'cm-strong')
    if (name === 'Strikethrough') return void mark(node.from, node.to, 'cm-strike')
    if (name === 'InlineCode') {
      mark(node.from, node.to, 'cm-inline-code')
      return
    }
    if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
      if (!lineActive(node.from)) hide(node.from, node.to)
      return
    }
    if (name === 'CodeMark') {
      // Backticks around inline code go; fence markers are handled with the
      // block below, where they stay visible but dimmed.
      const parent = node.node.parent?.name
      if (parent === 'InlineCode' && !lineActive(node.from)) hide(node.from, node.to)
      else if (parent === 'FencedCode') mark(node.from, node.to, 'cm-fence-mark')
      return
    }

    // --- Lists and checkboxes --------------------------------------------
    if (name === 'ListMark') {
      const item = node.node.parent
      const isTask = item?.firstChild?.nextSibling?.name === 'TaskMarker'
      const bulleted = /^[-*+]$/.test(text())
      if (isTask) {
        // "- " disappears: the checkbox is the marker.
        const after = state.sliceDoc(node.to, Math.min(node.to + 1, state.doc.length))
        hide(node.from, after === ' ' ? node.to + 1 : node.to)
      } else if (bulleted && !lineActive(node.from)) {
        replace(node.from, node.to, { widget: new BulletWidget() })
      }
      return
    }
    if (name === 'TaskMarker') {
      const checked = /\[[xX]\]/.test(text())
      replace(node.from, node.to, { widget: new CheckboxWidget(checked, node.from) })
      return
    }

    // --- Links, images and refs ------------------------------------------
    if (name === 'Wikilink') {
      if (lineActive(node.from)) return
      const raw = state.sliceDoc(node.from + 2, node.to - 2)
      const { target, display } = parseWikilinkTarget(raw)
      hide(node.from, node.from + 2)
      const pipe = raw.indexOf('|')
      if (pipe >= 0) hide(node.from + 2, node.from + 2 + pipe + 1)
      mark(pipe >= 0 ? node.from + 2 + pipe + 1 : node.from + 2, node.to - 2, 'cm-wikilink', {
        'data-wikilink': target,
        title: display ? `${display} → ${target}` : target,
      })
      hide(node.to - 2, node.to)
      return false
    }
    if (name === 'WikilinkEmbed') {
      if (lineActive(node.from)) return
      const raw = state.sliceDoc(node.from + 3, node.to - 2)
      const { target, display } = parseWikilinkTarget(raw)
      if (IMAGE_EXTENSIONS.test(target)) {
        replace(node.from, node.to, {
          widget: new ImageWidget(target, display ?? target, config.resolveAsset),
        })
        return false
      }
      // A non-image embed stays a link rather than pretending to inline a note.
      hide(node.from, node.from + 3)
      mark(node.from + 3, node.to - 2, 'cm-wikilink', { 'data-wikilink': target })
      hide(node.to - 2, node.to)
      return false
    }
    if (name === 'Image') {
      if (lineActive(node.from)) return
      const raw = text()
      const match = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(raw)
      if (!match) return
      replace(node.from, node.to, {
        widget: new ImageWidget(decodeURI(match[2]), match[1], config.resolveAsset),
      })
      return false
    }
    if (name === 'Link') {
      if (lineActive(node.from)) return
      const url = node.node.getChild('URL')
      const marks = node.node.getChildren('LinkMark')
      if (!url || marks.length < 2) return
      const href = state.sliceDoc(url.from, url.to)
      hide(node.from, marks[0].to) // the opening "["
      mark(marks[0].to, marks[1].from, 'cm-link', { 'data-href': href, title: href })
      hide(marks[1].from, node.to) // "](url)"
      return false
    }
    if (name === 'URL' && node.node.parent?.name === 'Autolink') {
      mark(node.from, node.to, 'cm-link', { 'data-href': text() })
      return
    }

    // --- Blockquotes -------------------------------------------------------
    if (name === 'Blockquote') {
      for (let pos = node.from; pos <= node.to; ) {
        const line = state.doc.lineAt(pos)
        lineClass(line.from, 'cm-quote')
        if (line.to + 1 > node.to) break
        pos = line.to + 1
      }
      return
    }
    if (name === 'QuoteMark') {
      if (!lineActive(node.from)) {
        const after = state.sliceDoc(node.to, Math.min(node.to + 1, state.doc.length))
        hide(node.from, after === ' ' ? node.to + 1 : node.to)
      }
      return
    }

    // --- Code fences -------------------------------------------------------
    if (name === 'FencedCode' || name === 'CodeBlock') {
      for (let pos = node.from; pos <= node.to; ) {
        const line = state.doc.lineAt(pos)
        lineClass(line.from, 'cm-code-line')
        if (line.to + 1 > node.to) break
        pos = line.to + 1
      }
      return
    }
    if (name === 'CodeInfo') {
      mark(node.from, node.to, 'cm-fence-mark')
      return
    }

    // --- Rules and tables --------------------------------------------------
    if (name === 'HorizontalRule') {
      if (!lineActive(node.from)) replace(node.from, node.to, { widget: new HorizontalRuleWidget() })
      return
    }
    if (name === 'Table') {
      if (blockActive(node.from, node.to)) {
        for (let pos = node.from; pos <= node.to; ) {
          const line = state.doc.lineAt(pos)
          lineClass(line.from, 'cm-table-source')
          if (line.to + 1 > node.to) break
          pos = line.to + 1
        }
        return
      }
      // Whole-block replacement: a table is only legible rendered.
      replace(node.from, node.to, {
        widget: new TableWidget(state.sliceDoc(node.from, node.to)),
        block: true,
      })
      return false
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    hidden: Decoration.set(hiddenRanges, true),
  }
}

function clickHandler(config: LivePreviewConfig): Extension {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const target = event.target as HTMLElement | null
      const el = target?.closest('[data-wikilink], [data-href]') as HTMLElement | null
      if (!el) return false
      // Plain click follows the link; modifier-click keeps the browser's
      // own behaviour for real URLs.
      const wikilink = el.getAttribute('data-wikilink')
      const href = el.getAttribute('data-href')
      if (wikilink) {
        event.preventDefault()
        config.openWikilink(wikilink)
        return true
      }
      if (href) {
        event.preventDefault()
        config.openUrl(href)
        return true
      }
      return false
    },
  })
}

/** Exported for tests: the decorations a state produces. */
export function decorationsFor(state: EditorState, config: LivePreviewConfig): Built {
  return build(state, config)
}
