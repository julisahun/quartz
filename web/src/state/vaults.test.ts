import { describe, expect, it } from 'vitest'
import type { VaultSummary } from '../api/client'
import {
  chooseVault,
  isLocal,
  mergeVaults,
  slugForVault,
  vaultHint,
  type LocalVaultSummary,
} from './vaults'

const mine: VaultSummary = { id: 'juli', name: 'juli', owner: 'juli', role: 'owner' }
const casa: VaultSummary = { id: 'casa', name: 'Casa', owner: 'maria', role: 'member' }
const folder: LocalVaultSummary = {
  id: 'local-8f14e45fce',
  name: 'Obsidian',
  kind: 'local',
  path: '/Users/juli/Documents/Obsidian',
}

describe('merging the vault list', () => {
  it('lists the account first and the folders after', () => {
    expect(mergeVaults([mine, casa], [folder]).map((v) => v.id)).toEqual([
      'juli',
      'casa',
      'local-8f14e45fce',
    ])
  })

  it('works with only folders, and with only an account', () => {
    expect(mergeVaults([], [folder]).map((v) => v.id)).toEqual(['local-8f14e45fce'])
    expect(mergeVaults([mine], []).map((v) => v.id)).toEqual(['juli'])
  })

  it('never lets a folder shadow a server vault of the same id', () => {
    // Two vaults answering to one id would share a store and a sync state, so
    // the folder gives way rather than quietly taking the synced one's place.
    const clash: LocalVaultSummary = { ...folder, id: 'juli' }
    const merged = mergeVaults([mine], [clash])
    expect(merged).toHaveLength(1)
    expect(isLocal(merged[0])).toBe(false)
  })
})

describe('choosing which vault to open', () => {
  it('reopens the last one used', () => {
    expect(chooseVault([mine, casa, folder], 'juli', 'casa')).toBe('casa')
    expect(chooseVault([mine, casa, folder], 'juli', 'local-8f14e45fce')).toBe('local-8f14e45fce')
  })

  it('falls back to the account own vault when the last one is gone', () => {
    expect(chooseVault([mine, casa], 'juli', 'forgotten')).toBe('juli')
    expect(chooseVault([mine, casa], 'juli')).toBe('juli')
  })

  it('opens a folder when there is no account at all', () => {
    expect(chooseVault([folder], '')).toBe('local-8f14e45fce')
    expect(chooseVault([], '')).toBeUndefined()
  })
})

describe('describing a vault', () => {
  it('says where each one lives, and whose it is', () => {
    // Ownership is the whole of it now: yours, somebody else's, or this
    // machine's. There is no third thing a vault can be.
    expect(vaultHint(mine, 'juli')).toBe('yours')
    expect(vaultHint(casa, 'juli')).toBe('shared · maria')
    expect(vaultHint(casa, 'maria')).toBe('yours')
    expect(vaultHint(folder, 'juli')).toBe('on this device')
  })
})

describe('the id a promoted vault takes', () => {
  it('makes a name into something the server and the disk both accept', () => {
    expect(slugForVault('Field notes')).toBe('field-notes')
    expect(slugForVault('Recetas de la Abuela')).toBe('recetas-de-la-abuela')
    expect(slugForVault('Día a día')).toBe('dia-a-dia')
    expect(slugForVault('notes/../escape')).toBe('notes-escape')
    expect(slugForVault('  padded  ')).toBe('padded')
    expect(slugForVault('keep.dots_and-dashes')).toBe('keep.dots_and-dashes')
  })

  it('gives back nothing when there is nothing to make an id from', () => {
    // The caller has to catch this: an empty id is refused by the server, and
    // "bad name" is a worse thing to read than being asked for another one.
    expect(slugForVault('!!!')).toBe('')
    expect(slugForVault('   ')).toBe('')
  })

  it('stays inside what the server calls a name', () => {
    for (const raw of ['Field notes', 'Día a día', 'a'.repeat(200), 'x/y\\z']) {
      const slug = slugForVault(raw)
      expect(slug).toMatch(/^[a-z0-9._-]*$/)
      expect(slug.length).toBeLessThanOrEqual(64)
    }
  })
})
