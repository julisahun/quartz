// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import { addToSlot, clearSlots, Slot } from './Slot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Slot name="sidebar.sections" />))
  return host
}

const texts = () => [...host!.querySelectorAll('span')].map((e) => e.textContent)

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  clearSlots()
})

describe('slots', () => {
  it('renders nothing at all when empty', () => {
    expect(render().innerHTML).toBe('')
  })

  it('renders what was put in, in `order` and then registration order', () => {
    addToSlot('sidebar.sections', { id: 'c', order: 1, render: () => <span>C</span> })
    addToSlot('sidebar.sections', { id: 'a', render: () => <span>A</span> })
    addToSlot('sidebar.sections', { id: 'b', render: () => <span>B</span> })
    render()
    expect(texts()).toEqual(['A', 'B', 'C'])
  })

  it('keeps each slot to itself', () => {
    addToSlot('status.items', { id: 'x', render: () => <span>X</span> })
    render()
    expect(texts()).toEqual([])
  })

  it('replaces an entry registered under the same id', () => {
    addToSlot('sidebar.sections', { id: 'a', render: () => <span>first</span> })
    addToSlot('sidebar.sections', { id: 'a', render: () => <span>second</span> })
    render()
    expect(texts()).toEqual(['second'])
  })

  it('takes an entry away again when its disposer is called', () => {
    const remove = addToSlot('sidebar.sections', { id: 'a', render: () => <span>A</span> })
    addToSlot('sidebar.sections', { id: 'b', render: () => <span>B</span> })
    render()
    act(() => remove())
    expect(texts()).toEqual(['B'])
  })

  it('hands the open note to whatever is rendering', () => {
    act(() => useApp.setState({ currentPath: 'notes/pi.md' }))
    addToSlot('sidebar.sections', { id: 'a', render: ({ path }) => <span>{path}</span> })
    render()
    expect(texts()).toEqual(['notes/pi.md'])
    act(() => useApp.setState({ currentPath: undefined }))
  })

  /**
   * The one that matters: whatever ends up in a slot was not written by the
   * screen showing it, so a throw has to cost that entry and nothing else.
   */
  it('contains a render that throws, and keeps its neighbours', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    addToSlot('sidebar.sections', {
      id: 'bad',
      render: () => {
        throw new Error('boom')
      },
    })
    addToSlot('sidebar.sections', { id: 'good', render: () => <span>still here</span> })
    render()
    expect(texts()).toEqual(['still here'])
    quiet.mockRestore()
  })
})
