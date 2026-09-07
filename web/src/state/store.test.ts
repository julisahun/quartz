// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useApp } from './store'

/**
 * Opening something that is not a note, through the real store: a PDF is a
 * path and a stream of bytes, and must never become a string.
 */

let vaultId = 0

function freshVault(): void {
  vaultId += 1
  useApp.setState({
    phase: 'ready',
    user: 'tester',
    device: 'test-device',
    vaults: [{ id: `pdf${vaultId}`, name: 'Test', owner: 'tester', role: 'owner' }],
    currentVault: `pdf${vaultId}`,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    backlinks: [],
    notices: [],
    syncNow: async () => {},
  })
}

/** A PDF's first bytes, which are not valid UTF-8 further in. */
function pdfFile(): File {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0xfe, 0x00, 0x80])
  return new File([bytes], 'carta.pdf', { type: 'application/pdf' })
}

afterEach(() => vi.restoreAllMocks())

describe('opening a file that is not a note', () => {
  it('never reads it into the editor buffer', async () => {
    freshVault()
    const path = await useApp.getState().attach(pdfFile())
    expect(path).toMatch(/\.pdf$/)

    await useApp.getState().open(path)
    expect(useApp.getState().currentPath).toBe(path)
    // Two megabytes of binary decoded as UTF-8 is rubbish in the buffer and a
    // copy of the file in memory.
    expect(useApp.getState().content).toBe('')
  })

  it('hands the bytes over as a PDF, not as bytes of no particular kind', async () => {
    freshVault()
    const path = await useApp.getState().attach(pdfFile())

    let handed: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      handed = blob as Blob
      return 'blob:fake'
    })

    expect(await useApp.getState().blobUrl(path)).toBe('blob:fake')
    expect(handed?.type).toBe('application/pdf')
  })

  it('says so when the file is not on this device', async () => {
    freshVault()
    await useApp.getState().open('mundo/missing.pdf')
    expect(useApp.getState().currentPath).toBeUndefined()
    expect(useApp.getState().notices.at(-1)?.text).toContain('not stored on this device')
  })
})
