import { indentLess, indentMore, redo, undo } from '@codemirror/commands'
import { EditorSelection, type Line } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * The editing commands the toolbar and the keymap share. They are here rather
 * than in `setup.ts` so a phone button and a keyboard shortcut can never drift
 * into doing two different things.
 */

/** A bullet, optionally already a task: `- `, `* [ ] `, … */
const BULLET = /^(\s*)(?:[-*+] )(?:\[[ xX]\] )?/
const TASK = /^(\s*)(?:[-*+] )\[[ xX]\] /
const QUOTE = /^(\s*)> /
const HEADING = /^(#{1,6}) /

export { indentLess, indentMore, redo, undo }

/** Wraps the selection in a marker, or unwraps it when it is already wrapped. */
export function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view
  const len = marker.length
  view.dispatch(
    state.changeByRange((range) => {
      const before = state.sliceDoc(Math.max(0, range.from - len), range.from)
      const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + len))
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - len, to: range.from },
            { from: range.to, to: range.to + len },
          ],
          range: EditorSelection.range(range.from - len, range.to - len),
        }
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker },
        ],
        range: EditorSelection.range(range.from + len, range.to + len),
      }
    }),
    { scrollIntoView: true },
  )
  return true
}

/** Every line the selection touches, each one once. */
function selectedLines(view: EditorView): Line[] {
  const { state } = view
  const lines: Line[] = []
  let last = -1
  for (const range of state.selection.ranges) {
    let pos = range.from
    while (pos <= range.to) {
      const line = state.doc.lineAt(pos)
      if (line.number > last) {
        lines.push(line)
        last = line.number
      }
      if (line.to >= state.doc.length) break
      pos = line.to + 1
    }
  }
  return lines
}

/**
 * `#` → `##` → `###` → plain, on every line the selection touches. One button
 * that cycles beats three buttons on a strip this narrow.
 */
export function cycleHeading(view: EditorView): boolean {
  const changes = selectedLines(view).map((line) => {
    const match = line.text.match(HEADING)
    const level = match ? match[1].length : 0
    const next = level >= 3 ? 0 : level + 1
    return {
      from: line.from,
      to: line.from + (match ? match[0].length : 0),
      insert: next === 0 ? '' : `${'#'.repeat(next)} `,
    }
  })
  view.dispatch({ changes, scrollIntoView: true })
  return true
}

/** Adds `- `, turns a task back into a plain bullet, or removes the bullet. */
export function toggleBullet(view: EditorView): boolean {
  const changes = selectedLines(view).map((line) => {
    const task = line.text.match(TASK)
    if (task) return { from: line.from, to: line.from + task[0].length, insert: `${task[1]}- ` }
    const bullet = line.text.match(BULLET)
    if (bullet) return { from: line.from, to: line.from + bullet[0].length, insert: bullet[1] }
    const indent = line.text.match(/^\s*/)?.[0] ?? ''
    return { from: line.from + indent.length, to: line.from + indent.length, insert: '- ' }
  })
  view.dispatch({ changes, scrollIntoView: true })
  return true
}

/** Adds `- [ ] `, or takes the whole marker off a line that already has one. */
export function toggleTask(view: EditorView): boolean {
  const changes = selectedLines(view).map((line) => {
    const task = line.text.match(TASK)
    if (task) return { from: line.from, to: line.from + task[0].length, insert: task[1] }
    const bullet = line.text.match(BULLET)
    if (bullet) return { from: line.from, to: line.from + bullet[0].length, insert: `${bullet[1]}- [ ] ` }
    const indent = line.text.match(/^\s*/)?.[0] ?? ''
    return { from: line.from + indent.length, to: line.from + indent.length, insert: '- [ ] ' }
  })
  view.dispatch({ changes, scrollIntoView: true })
  return true
}

export function toggleQuote(view: EditorView): boolean {
  const lines = selectedLines(view)
  const allQuoted = lines.every((line) => QUOTE.test(line.text))
  const changes = lines.map((line) => {
    const match = line.text.match(QUOTE)
    if (allQuoted && match) return { from: line.from, to: line.from + match[0].length, insert: match[1] }
    if (match) return { from: line.from, to: line.from, insert: '' }
    const indent = line.text.match(/^\s*/)?.[0] ?? ''
    return { from: line.from + indent.length, to: line.from + indent.length, insert: '> ' }
  })
  view.dispatch({ changes, scrollIntoView: true })
  return true
}

/**
 * `[text](url)` with `url` selected, so the next thing typed replaces it —
 * the address is the part you always have to fill in.
 */
export function insertLink(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to) || 'text'
  const inserted = `[${text}](url)`
  const urlFrom = range.from + text.length + 3
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: EditorSelection.range(urlFrom, urlFrom + 3),
    scrollIntoView: true,
  })
  return true
}

/** `[[selection]]`, cursor left inside the brackets when there is nothing to wrap. */
export function insertWikilink(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  const text = state.sliceDoc(range.from, range.to)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
    selection: EditorSelection.range(range.from + 2, range.from + 2 + text.length),
    scrollIntoView: true,
  })
  return true
}

/**
 * Stores each file in the vault and leaves an embed behind, the way Obsidian
 * does. Shared by paste, drop and the toolbar's picker, so a photo taken on a
 * phone lands exactly where a pasted screenshot would.
 */
export async function insertAttachments(
  view: EditorView,
  files: Iterable<File>,
  attach: (file: File) => Promise<string>,
): Promise<void> {
  for (const file of files) {
    const path = await attach(file)
    const embed = file.type.startsWith('image/') ? `![[${path}]]` : `[[${path}]]`
    const pos = view.state.selection.main.head
    view.dispatch({
      changes: { from: pos, insert: `${embed}\n` },
      selection: { anchor: pos + embed.length + 1 },
      scrollIntoView: true,
    })
  }
}
