// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createVaultStore } from '.'
import { FolderVaultStore } from './folder-store'
import { isFolderBacked } from './folders'
import { IdbVaultStore } from './idb-store'

/**
 * Which side of the storage seam a vault gets is a fact about the vault on this
 * device, not about the platform. The shell used to answer "folder" for
 * everything, which is what cloned every synced vault the instant it was
 * opened — notes appearing in ~/Documents/quartz that nobody asked for.
 */
describe('choosing the side of the storage seam', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('keeps a vault in the app unless it has a folder', () => {
    expect(createVaultStore('juli', 'talasia', false)).toBeInstanceOf(IdbVaultStore)
    expect(createVaultStore('juli', 'talasia', true)).toBeInstanceOf(FolderVaultStore)
  })

  it('gives each account its own store for the same vault', () => {
    // Two accounts on one browser must never share a local store.
    const mine = createVaultStore('juli', 'casa', false)
    const theirs = createVaultStore('maria', 'casa', false)
    expect(mine).not.toBe(theirs)
  })

  it('does not call every vault a folder just because this is the shell', () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async () => [],
    }
    // Nothing has recorded a folder for it, so the answer is no — and the
    // vault is kept in the app rather than materialising a directory.
    expect(isFolderBacked('talasia')).toBe(false)
    expect(createVaultStore('juli', 'talasia', isFolderBacked('talasia'))).toBeInstanceOf(
      IdbVaultStore,
    )
  })
})
