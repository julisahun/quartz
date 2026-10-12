import type { ReactNode } from 'react'

/**
 * Just enough markdown to read a day back: headings, paragraphs, lists,
 * tasks, quotes and code, with bold, italic, inline code and wikilinks inside
 * them. Read-only and deliberately small — anything it does not know is shown
 * as the text it is, which for a journal is nearly always right.
 *
 * The frontmatter and the first heading are dropped: the template writes the
 * date in both, and the calendar already shows it above the note.
 */
export function NoteBody({ text }: { text: string }) {
  const blocks = parse(stripTemplate(text))
  if (blocks.length === 0) return <p className="px-md-empty">Nothing written yet.</p>
  return <div className="px-md">{blocks.map(render)}</div>
}

/** The first thing written, as one line: what a month cell has room for. */
export function firstLine(text: string): string {
  for (const block of parse(stripTemplate(text))) {
    if (block.kind === 'code') continue
    const line = 'text' in block ? block.text : ''
    const plain = line.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, target, alias) => alias || target)
    const clean = plain.replace(/[*_`]/g, '').trim()
    if (clean) return clean
  }
  return ''
}

export function stripTemplate(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s*#\s[^\n]*\n?/, '')
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'item'; text: string; depth: number }
  | { kind: 'task'; text: string; done: boolean; depth: number }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; lines: string[] }

function parse(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split(/\r?\n/)
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i])
      blocks.push({ kind: 'code', lines: code })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      continue
    }
    const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      flush()
      blocks.push({ kind: 'task', text: task[3], done: task[2] !== ' ', depth: depthOf(task[1]) })
      continue
    }
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      flush()
      blocks.push({ kind: 'item', text: item[2], depth: depthOf(item[1]) })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flush()
      blocks.push({ kind: 'quote', text: quote[1] })
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

function depthOf(indent: string): number {
  return Math.min(3, Math.floor(indent.replace(/\t/g, '  ').length / 2))
}

function render(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case 'heading':
      return block.level <= 2 ? (
        <h3 key={key}>{inline(block.text)}</h3>
      ) : (
        <h4 key={key}>{inline(block.text)}</h4>
      )
    case 'paragraph':
      return <p key={key}>{inline(block.text)}</p>
    case 'item':
      return (
        <div key={key} className="px-md-item" style={{ marginLeft: `${block.depth * 1.1}rem` }}>
          <span className="px-md-bullet" aria-hidden="true">•</span>
          <span>{inline(block.text)}</span>
        </div>
      )
    case 'task':
      return (
        <div key={key} className={`px-md-item ${block.done ? 'done' : ''}`} style={{ marginLeft: `${block.depth * 1.1}rem` }}>
          <span className={`px-md-box ${block.done ? 'checked' : ''}`} aria-label={block.done ? 'Done' : 'Not done'} />
          <span>{inline(block.text)}</span>
        </div>
      )
    case 'quote':
      return <blockquote key={key}>{inline(block.text)}</blockquote>
    case 'code':
      return <pre key={key}>{block.lines.join('\n')}</pre>
  }
}

/** Bold, italic, inline code, embeds and wikilinks; everything else as written. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`]+`)|(!\[\[[^\]]+\]\])|(\[\[[^\]]+\]\])|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*]+\*|_[^_]+_)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const [token] = match
    const key = match.index
    if (match[1]) out.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (match[2]) out.push(<span key={key} className="px-md-embed">{token.slice(3, -2)}</span>)
    else if (match[3]) {
      const [target, alias] = token.slice(2, -2).split('|')
      out.push(<span key={key} className="px-md-link">{alias || target}</span>)
    } else if (match[4]) out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = key + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
