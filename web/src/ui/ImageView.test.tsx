// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from '../state/store'
import { ImageView } from './ImageView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined

const PATH = 'mundo/talasia/mapa-costa.png'

/** Renders the pane over a vault holding one image. */
async function render(options: { blobUrl?: () => Promise<string | undefined> } = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    useApp.setState({
      currentPath: PATH,
      files: [{ path: PATH, hash: 'h', size: 640_000, mtime: 0 }],
      blobUrl: options.blobUrl ?? (async () => 'blob:quartz/1'),
    })
  })
  root = createRoot(host)
  await act(async () => {
    root!.render(<ImageView path={PATH} />)
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

describe('ImageView', () => {
  it('shows the image, named and weighed', async () => {
    const dom = await render()
    // The extension is part of an image's name, as it is for a PDF.
    expect(dom.querySelector('.fileview-name')?.textContent).toBe('mapa-costa.png')
    expect(dom.querySelector('.fileview-size')?.textContent).toBe('625 KB')
    const img = dom.querySelector<HTMLImageElement>('img.image-full')
    expect(img?.getAttribute('src')).toBe('blob:quartz/1')
    expect(img?.getAttribute('alt')).toBe('mapa-costa.png')
  })

  it('starts fitted to the pane and toggles to the image own size', async () => {
    const dom = await render()
    const box = () => dom.querySelector('.image-box')!
    expect(box().className).not.toContain('actual')

    await act(async () => {
      dom.querySelector<HTMLImageElement>('img.image-full')!.click()
    })
    // A scanned page is illegible shrunk into a pane; this is the way out.
    expect(box().className).toContain('actual')

    await act(async () => {
      dom.querySelector<HTMLImageElement>('img.image-full')!.click()
    })
    expect(box().className).not.toContain('actual')
  })

  it('always offers to save a copy', async () => {
    const dom = await render()
    const save = dom.querySelector<HTMLAnchorElement>('a[download]')
    expect(save?.getAttribute('href')).toBe('blob:quartz/1')
    expect(save?.getAttribute('download')).toBe('mapa-costa.png')
  })

  it('says so when the bytes are not on this device', async () => {
    const dom = await render({ blobUrl: async () => undefined })
    expect(dom.textContent).toContain('not stored on this device')
    expect(dom.querySelector('img.image-full')).toBeNull()
  })

  it('says so when the bytes are there and are not an image', async () => {
    const dom = await render()
    await act(async () => {
      dom.querySelector<HTMLImageElement>('img.image-full')!.dispatchEvent(new Event('error'))
    })
    expect(dom.textContent).toContain('could not be displayed')
  })

  it('lets the file go when it closes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    await render()
    act(() => root!.unmount())
    root = undefined
    // The URL pins the whole image in memory until it is revoked.
    expect(revoke).toHaveBeenCalledWith('blob:quartz/1')
  })
})
