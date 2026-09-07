// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createVaultStore } from '../vault'
import { useApp } from './store'

/**
 * Renaming, end to end through the real IndexedDB store: this is the one part
 * of backlinks that writes to several notes at once, so it is worth exercising
 * against the seam rather than a fake.
 */

let vaultId = 0

/** A vault of its own per test, so nothing leaks between them. */
function freshVault(): void {
  vaultId += 1
  useApp.setState({
    phase: 'ready',
    user: 'tester',
    device: 'test-device',
    vaults: [{ id: `v${vaultId}`, name: 'Test', owner: 'tester', role: 'owner' }],
    currentVault: `v${vaultId}`,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    backlinks: [],
    notices: [],
    // Every write schedules one. Nothing here should reach the network, and
    // IndexedDB needs real timers, so the action itself is the thing to stub.
    syncNow: async () => {},
  })
}

/** Creates a note with a body, through the same calls the editor makes. */
async function write(title: string, body: string): Promise<string> {
  const app = useApp.getState()
  const path = await app.createNote(title)
  useApp.getState().edit(body)
  await useApp.getState().save()
  return path
}

async function read(path: string): Promise<string> {
  await useApp.getState().open(path)
  return useApp.getState().content
}

beforeEach(freshVault)

describe('renameNote', () => {
  it('carries the links with it when asked', async () => {
    await write('Pi setup', '# Pi setup\n')
    await write('Journal', 'ran through [[Pi setup]] and [[Pi setup#Ports|the ports]]\n')
    await write('Ideas', 'nothing relevant\n')

    const target = await useApp.getState().renameNote('Pi setup.md', 'Raspberry Pi.md', true)
    expect(target).toBe('Raspberry Pi.md')

    expect(await read('Journal.md')).toBe(
      'ran through [[Raspberry Pi]] and [[Raspberry Pi#Ports|the ports]]\n',
    )
    expect(await read('Ideas.md')).toBe('nothing relevant\n')
    expect(useApp.getState().files.map((f) => f.path)).toContain('Raspberry Pi.md')
    expect(useApp.getState().files.map((f) => f.path)).not.toContain('Pi setup.md')
  })

  it('leaves the links alone when not asked', async () => {
    await write('Pi setup', '# Pi setup\n')
    await write('Journal', 'ran through [[Pi setup]]\n')

    await useApp.getState().renameNote('Pi setup.md', 'Raspberry Pi.md', false)

    expect(await read('Journal.md')).toBe('ran through [[Pi setup]]\n')
  })

  it('shows the renamed note under its new name, contents intact', async () => {
    await write('Pi setup', '# Pi setup\n\nport 8086\n')
    await useApp.getState().open('Pi setup.md')

    await useApp.getState().renameNote('Pi setup.md', 'notes/Raspberry Pi.md', true)

    expect(useApp.getState().currentPath).toBe('notes/Raspberry Pi.md')
    expect(useApp.getState().content).toBe('# Pi setup\n\nport 8086\n')
  })

  it('does not lose what is still in the buffer', async () => {
    await write('Pi setup', 'saved\n')
    useApp.getState().edit('typed but not saved\n')

    await useApp.getState().renameNote('Pi setup.md', 'Raspberry Pi.md', false)

    expect(await read('Raspberry Pi.md')).toBe('typed but not saved\n')
  })

  it('updates the note being read when it is one of the rewritten ones', async () => {
    await write('Pi setup', '# Pi setup\n')
    await write('Journal', 'see [[Pi setup]]\n')
    await useApp.getState().open('Journal.md')

    await useApp.getState().renameNote('Pi setup.md', 'Raspberry Pi.md', true)

    expect(useApp.getState().currentPath).toBe('Journal.md')
    expect(useApp.getState().content).toBe('see [[Raspberry Pi]]\n')
  })

  it('counts the notes that link here, not the mentions', async () => {
    await write('Pi setup', '# Pi setup\n')
    await write('Journal', '[[Pi setup]] twice: [[Pi setup]]\n')
    await write('Ideas', 'once: [[Pi setup]]\n')

    expect(await useApp.getState().linksTo('Pi setup.md')).toBe(2)
    expect(await useApp.getState().linksTo('Ideas.md')).toBe(0)
  })

  it('queues every rewritten note for the server', async () => {
    await write('Pi setup', '# Pi setup\n')
    await write('Journal', 'see [[Pi setup]]\n')

    await useApp.getState().renameNote('Pi setup.md', 'Raspberry Pi.md', true)

    // The note under its new name, and the one whose link moved with it. The
    // old path leaves no tombstone: the server never saw it, so there is
    // nothing to tell it about.
    const store = createVaultStore('tester', `v${vaultId}`)
    const queued = await store.pending()
    expect(queued).toEqual([
      { op: 'put', path: 'Journal.md', baseHash: '' },
      { op: 'put', path: 'Raspberry Pi.md', baseHash: '' },
    ])
  })
})
