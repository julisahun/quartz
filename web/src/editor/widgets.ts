import { EditorView, WidgetType } from '@codemirror/view'
import { frontmatterTags, parseFrontmatter, type Property } from '../state/frontmatter'
import { renderInline } from './inline'

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
    // Cells carry the same markup as the rest of a note — this vault's tables
    // are half wikilinks — so they are rendered rather than printed. A cell
    // showing "[[acero-del-manantial|Acero]]" is a table you cannot read.
    renderInline(cell, el)
    if (alignments[i]) el.style.textAlign = alignments[i]
    tr.appendChild(el)
  })
  return tr
}

/**
 * An embedded file that is not an image: a card, rather than a bare link.
 *
 * `![[handout.pdf]]` says "this document belongs here", and a line of link
 * text does not carry that. It deliberately does not render the PDF in place:
 * a scrolling document inside a scrolling note is a poor thing on a desktop
 * and an unusable one on a phone. Clicking opens it in the pane, through the
 * same `data-wikilink` the editor already follows.
 */
export class FileCardWidget extends WidgetType {
  constructor(
    private readonly target: string,
    private readonly label: string,
    private readonly kind: string,
  ) {
    super()
  }

  eq(other: FileCardWidget): boolean {
    return other.target === this.target && other.label === this.label
  }

  toDOM(): HTMLElement {
    const card = document.createElement('span')
    card.className = 'cm-file-card'
    card.dataset.wikilink = this.target
    card.title = this.target

    const name = document.createElement('span')
    name.className = 'cm-file-name'
    name.textContent = this.label
    card.appendChild(name)

    const kind = document.createElement('span')
    kind.className = 'cm-file-kind'
    kind.textContent = this.kind
    card.appendChild(kind)
    return card
  }

  ignoreEvent(): boolean {
    return false
  }
}

/**
 * A note's frontmatter, as the properties it is.
 *
 * Without this the block is not neutral, it is wrong: `---` parses as a
 * horizontal rule, the YAML under it as a paragraph, and the closing `---`
 * turns that paragraph into a setext heading. What the reader saw was their
 * metadata set in 24pt.
 */
export class PropertiesWidget extends WidgetType {
  constructor(private readonly source: string) {
    super()
  }

  eq(other: PropertiesWidget): boolean {
    return other.source === this.source
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-props'
    const props = parseFrontmatter(this.source)

    if (props.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'cm-props-empty'
      empty.textContent = 'No properties'
      wrap.appendChild(empty)
      return wrap
    }

    const table = document.createElement('table')
    table.className = 'cm-props-table'
    const body = document.createElement('tbody')
    for (const prop of props) body.appendChild(propertyRow(prop))
    table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

function propertyRow(prop: Property): HTMLTableRowElement {
  const tr = document.createElement('tr')
  const key = document.createElement('th')
  key.textContent = prop.key
  tr.appendChild(key)

  const cell = document.createElement('td')
  const tags = frontmatterTags([prop])

  if (tags.length > 0) {
    // Declared without the "#", but they are the same tags the body writes and
    // the sidebar indexes, so they are the same chips and click the same way.
    for (const tag of tags) {
      const chip = document.createElement('span')
      chip.className = 'cm-tag'
      chip.dataset.tag = tag
      chip.textContent = `#${tag}`
      cell.appendChild(chip)
      cell.appendChild(document.createTextNode(' '))
    }
  } else if (Array.isArray(prop.value)) {
    const list = document.createElement('div')
    list.className = 'cm-props-list'
    for (const item of prop.value) {
      const row = document.createElement('div')
      row.className = 'cm-props-item'
      renderInline(item, row)
      list.appendChild(row)
    }
    cell.appendChild(list)
  } else {
    renderInline(prop.value, cell)
  }

  tr.appendChild(cell)
  return tr
}
