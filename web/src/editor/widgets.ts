import { EditorView, WidgetType } from '@codemirror/view'

/** A clickable task checkbox in place of `- [ ]`. */
export class CheckboxWidget extends WidgetType {
  constructor(
    private readonly checked: boolean,
    private readonly pos: number,
  ) {
    super()
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.className = 'cm-task-checkbox'
    box.addEventListener('mousedown', (event) => {
      event.preventDefault()
      // The marker is exactly "[ ]" or "[x]"; swap the middle character.
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? ' ' : 'x' },
      })
    })
    return box
  }

  ignoreEvent(): boolean {
    return false
  }
}

/** A bullet in place of `-`, `*` or `+`. */
export class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-bullet'
    span.textContent = '•'
    return span
  }
}

export class HorizontalRuleWidget extends WidgetType {
  eq(): boolean {
    return true
  }

  toDOM(): HTMLElement {
    const hr = document.createElement('hr')
    hr.className = 'cm-hr'
    return hr
  }
}

/**
 * An embedded image. The bytes live in the local vault, so the source is
 * resolved asynchronously and swapped in when it arrives — which also means
 * images work offline.
 */
export class ImageWidget extends WidgetType {
  constructor(
    private readonly src: string,
    private readonly alt: string,
    private readonly resolve: (path: string) => Promise<string | undefined>,
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-embed'
    const img = document.createElement('img')
    img.alt = this.alt
    img.className = 'cm-embed-img'
    wrap.appendChild(img)

    if (/^(https?:)?\/\//.test(this.src) || this.src.startsWith('data:')) {
      img.src = this.src
    } else {
      void this.resolve(this.src).then((url) => {
        if (url) img.src = url
        else {
          wrap.classList.add('cm-embed-missing')
          wrap.textContent = `missing attachment: ${this.src}`
        }
      })
    }
    return wrap
  }
}

/** A rendered table, shown while the cursor is elsewhere. */
export class TableWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-wrap'
    const table = document.createElement('table')
    table.className = 'cm-table'

    const rows = this.source.split('\n').filter((line) => line.trim() !== '')
    const alignments = rows.length > 1 ? parseAlignments(rows[1]) : []
    const bodyStart = alignments.length ? 2 : 1

    if (rows.length) {
      const head = document.createElement('thead')
      head.appendChild(rowElement(rows[0], 'th', alignments))
      table.appendChild(head)
    }
    const body = document.createElement('tbody')
    for (const row of rows.slice(bodyStart)) {
      body.appendChild(rowElement(row, 'td', alignments))
    }
    table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
    } else if (ch === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function parseAlignments(line: string): ('left' | 'center' | 'right')[] {
  const cells = splitRow(line)
  if (!cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')))) return []
  return cells.map((c) => {
    const cell = c.trim()
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return 'left'
  })
}

function rowElement(
  line: string,
  cellTag: 'th' | 'td',
  alignments: ('left' | 'center' | 'right')[],
): HTMLTableRowElement {
  const tr = document.createElement('tr')
  splitRow(line).forEach((cell, i) => {
    const el = document.createElement(cellTag)
    // Inline markup inside cells is rendered as plain text on purpose: the
    // raw source is one keystroke away, and a half-parser here would lie.
    el.textContent = cell.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1')
    if (alignments[i]) el.style.textAlign = alignments[i]
    tr.appendChild(el)
  })
  return tr
}
