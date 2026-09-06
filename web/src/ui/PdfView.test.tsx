// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import { PdfView } from './PdfView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const PATH = 'mundo/talasia-carta.pdf'

/** Renders the pane over a vault holding one PDF. `viewer` is what the browser says it has. */
async function render(options: { viewer?: boolean; blobUrl?: () => Promise<string | undefined> } = {}) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', {
    value: options.viewer ?? true,
    configurable: true,
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({
      currentPath: PATH,
      files: [{ path: PATH, hash: 'h', size: 1_887_436, mtime: 0 }],
      blobUrl: options.blobUrl ?? (async () => 'blob:quartz/1'),
    })
  })
  root = createRoot(host)
  await act(async () => {
    root!.render(<PdfView path={PATH} />)
  })
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  vi.restoreAllMocks()
})

describe('PdfView', () => {
  it('shows the file in a frame, named and weighed', async () => {
    const dom = await render()
    expect(dom.querySelector('.pdf-name')?.textContent).toBe('talasia-carta.pdf')
    expect(dom.querySelector('.pdf-size')?.textContent).toBe('1.8 MB')
    expect(dom.querySelector('iframe.pdf-frame')?.getAttribute('src')).toBe('blob:quartz/1')
  })

  it('offers a way out instead of a dead frame where the browser has no viewer', async () => {
    // iOS renders a PDF as a whole page perfectly well; it is a frame inside a
    // page that it refuses to scroll.
    const dom = await render({ viewer: false })
    expect(dom.querySelector('iframe')).toBeNull()
    expect(dom.textContent).toContain('will not scroll a PDF inside a page')
    expect(dom.querySelector('.pdf-out button')?.textContent).toContain('talasia-carta.pdf')
  })

  it('always offers to save a copy', async () => {
    const dom = await render()
    const save = dom.querySelector<HTMLAnchorElement>('a[download]')
    expect(save?.getAttribute('href')).toBe('blob:quartz/1')
    expect(save?.getAttribute('download')).toBe('talasia-carta.pdf')
  })

  it('says so when the bytes are not on this device', async () => {
    const dom = await render({ blobUrl: async () => undefined })
    expect(dom.textContent).toContain('not stored on this device')
  })

  it('lets the file go when it closes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await render()
    act(() => root!.unmount())
    root = undefined
    // The URL pins the whole file in memory until it is revoked.
    expect(revoke).toHaveBeenCalledWith('blob:quartz/1')
  })
})
