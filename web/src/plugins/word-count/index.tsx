import type { Quartz, QuartzPlugin } from '../api'

/**
 * How long the open note is, in the status bar.
 *
 * The smallest useful thing a plugin can be, and the one that proves the
 * status slot: it renders from the editor's own buffer, so it counts what is
 * on screen rather than what was last saved.
 */
export const wordCount: QuartzPlugin = {
  id: 'word-count',
  name: 'Word count',
  description: 'How long the open note is, in the status bar, counted from the editor rather than the last save.',
  author: 'Quartz',
  version: '1.0.0',
  icon: '¶',
  setup(q) {
    q.ui.statusItem({ id: 'count', render: () => <Count q={q} /> })
  },
}

function Count({ q }: { q: Quartz }) {
  const { current, text } = q.vault.useVault()
  if (!current || !current.endsWith('.md')) return null

  const words = countWords(text)
  return (
    <span className="px-count" title={`${text.length} characters`}>
      {words} {words === 1 ? 'word' : 'words'}
    </span>
  )
}

/**
 * Words as a person would count them, near enough.
 *
 * Frontmatter is dropped — it is metadata, not writing — and everything else
 * is counted as written, markers included. Trying to discount the `**` around
 * a word costs more than it is worth for a number nobody audits.
 */
function countWords(text: string): number {
  const body = text.startsWith('---') ? text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : text
  const words = body.match(/[\p{L}\p{N}'’-]+/gu)
  return words ? words.length : 0
}
