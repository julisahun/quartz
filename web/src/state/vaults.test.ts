import { describe, expect, it } from 'vitest'
import type { VaultSummary } from '../api/client'
import { chooseVault, mergeVaults, vaultHint, type LocalVaultSummary } from './vaults'

const mine: VaultSummary = { id: 'juli', name: 'juli', kind: 'private', owner: 'juli', role: 'owner' }
const casa: VaultSummary = { id: 'casa', name: 'Casa', kind: 'shared', owner: 'maria', role: 'member' }
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
    expect(merged[0].kind).toBe('private')
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
  it('says where each one lives', () => {
    expect(vaultHint(mine, 'juli')).toBe('private')
    expect(vaultHint(casa, 'juli')).toBe('shared · maria')
    expect(vaultHint(casa, 'maria')).toBe('shared')
    expect(vaultHint(folder, 'juli')).toBe('on this device')
  })
})
