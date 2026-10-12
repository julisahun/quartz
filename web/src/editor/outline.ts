/** One heading of a note, for the outline. */
export interface Heading {
  level: number
  text: string
  /** 1-based, as CodeMirror's `doc.line()` takes it. */
  line: number
}

const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^\s*(```|~~~)/

/**
 * The ATX headings of a note, in order. What looks like a heading inside a
 * fenced block is a comment in somebody's shell script, and front matter is
 * not part of the note's outline either, so both are skipped.
 */
export function headings(text: string): Heading[] {
  const lines = text.split('\n')
  const found: Heading[] = []
  let i = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---')
    if (end > 0) i = end + 1
  }
  let fence: string | undefined
  for (; i < lines.length; i++) {
    const line = lines[i]
    const opened = FENCE.exec(line)
    if (opened) {
      if (!fence) fence = opened[1]
      else if (opened[1] === fence) fence = undefined
      continue
    }
    if (fence) continue
    const match = HEADING.exec(line)
    if (match) found.push({ level: match[1].length, text: match[2].trim(), line: i + 1 })
  }
  return found
}
