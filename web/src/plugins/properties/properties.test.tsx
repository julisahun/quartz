// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQuartz, type FakeQuartz } from '../fake-quartz'
import { properties } from '.'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined
let q: FakeQuartz

const note = (props: string, body = 'text') => `---\n${props}\n---\n\n${body}\n`

/** Renders the section the plugin registered, and lets the scan settle. */
async function show(files: Record<string, string>) {
  q = fakeQuartz(files)
  let render: (() => ReactNode) | undefined
  q.ui.sidebarSection = (section) => {
    render = section.render
  }
  properties.setup(q)

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<>{render!()}</>)
  })
  return host
}

const groups = () =>
  [...host!.querySelectorAll('.px-group')].map((group) => ({
    value: group.querySelector('.px-group-value')?.textContent,
    notes: [...group.querySelectorAll('.px-group-note')].map((n) => n.textContent),
  }))

const picker = () => host!.querySelector<HTMLSelectElement>('.px-property-pick')
const options = () => [...(picker()?.options ?? [])].map((o) => o.value)

beforeEach(() => {
  // The section remembers being open; these tests want it open from the start.
  localStorage.setItem('section:properties', 'open')
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  localStorage.clear()
})

describe('notes by property', () => {
  it('groups the notes under the values of the commonest property', async () => {
    await show({
      'a.md': note('status: doing'),
      'b.md': note('status: done'),
      'c.md': note('status: doing'),
    })
    expect(picker()?.value).toBe('status')
    expect(groups()).toEqual([
      { value: 'doing', notes: ['a', 'c'] },
      { value: 'done', notes: ['b'] },
    ])
  })

  it('offers the properties the vault actually has, commonest first', async () => {
    await show({
      'a.md': note('status: doing\nowner: juli'),
      'b.md': note('status: done'),
    })
    expect(options()).toEqual(['status', 'owner'])
  })

  it('groups a note under every entry of a list property', async () => {
    await show({ 'a.md': note('tags: [pi, notes]'), 'b.md': note('tags: [pi]') })
    expect(groups()).toEqual([
      { value: 'pi', notes: ['a', 'b'] },
      { value: 'notes', notes: ['a'] },
    ])
  })

  it('switches to whichever property is picked', async () => {
    await show({
      'a.md': note('status: doing\nowner: juli'),
      'b.md': note('status: done\nowner: maria'),
    })
    const select = picker()!
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setValue.call(select, 'owner')
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(groups().map((g) => g.value)).toEqual(['juli', 'maria'])
  })

  it('opens the note that is clicked', async () => {
    await show({ 'a.md': note('status: doing') })
    act(() => host!.querySelector<HTMLButtonElement>('.px-group-note')!.click())
    expect(q.opened).toEqual(['a.md'])
  })

  it('says so when nothing here has frontmatter', async () => {
    await show({ 'a.md': '# Just a note\n' })
    expect(host!.textContent).toContain('No note here has frontmatter yet')
  })

  it('says so when the vault is empty', async () => {
    await show({})
    expect(host!.textContent).toContain('No notes yet')
  })

  it('skips a note it cannot read rather than failing the panel', async () => {
    q = fakeQuartz({ 'a.md': note('status: doing'), 'gone.md': '' })
    const real = q.vault.read
    q.vault.read = async (path) => {
      if (path === 'gone.md') throw new Error('vanished')
      return real(path)
    }
    let render: (() => ReactNode) | undefined
    q.ui.sidebarSection = (section) => {
      render = section.render
    }
    properties.setup(q)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<>{render!()}</>)
    })

    expect(groups()).toEqual([{ value: 'doing', notes: ['a'] }])
  })

  /**
   * The scan is the expensive part — it reads every note — so it must not run
   * behind a closed panel, which is how it is shipped.
   */
  it('reads nothing at all while the section is closed', async () => {
    localStorage.setItem('section:properties', 'closed')
    q = fakeQuartz({ 'a.md': note('status: doing') })
    const read = vi.spyOn(q.vault, 'read')
    let render: (() => ReactNode) | undefined
    q.ui.sidebarSection = (section) => {
      render = section.render
    }
    properties.setup(q)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<>{render!()}</>)
    })

    expect(read).not.toHaveBeenCalled()
    expect(host.querySelector('.px-property')).toBeNull()
  })
})
