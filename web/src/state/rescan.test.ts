// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdbVaultStore } from '../vault/idb-store'
import { encodeText } from '../vault/types'
import { useApp } from './store'

/**
 * A vault the app has open is not a vault only the app writes to. One kept as
 * a folder is open to Obsidian, to Finder, to git and to a download, and a
 * synced one moves whenever another device pushes — so what the app shows has
 * to come from looking again, not from remembering what it did last.
 *
 * The writer here is a second store over the same database: the app's own
 * runtime never sees these calls, which is what makes them stand for somebody
 * writing into the folder behind its back.
 */

let vaultId = 0
let outside: IdbVaultStore

/** A local vault, and a way into its storage that the app knows nothing about. */
function freshVault(): void {
  vaultId += 1
  const id = `rescan${vaultId}`
  useApp.setState({
    phase: 'ready',
    user: 'tester',
    device: 'test-device',
    vaults: [{ id, name: 'Loaded', kind: 'local' }],
    currentVault: id,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    backlinks: [],
    tags: [],
    notices: [],
    sync: 'local',
  })
  outside = new IdbVaultStore(`quartz-tester-${id}`)
}

const paths = () => useApp.getState().files.map((f) => f.path)

describe('a loaded vault', () => {
  beforeEach(() => freshVault())

  it('discovers a file that appeared in it', async () => {
    await useApp.getState().createNote('First')
    expect(paths()).toEqual(['First.md'])

    // Dropped in from Finder, or pulled in by git.
    await outside.write('dropped.md', encodeText('from finder\n'))
    expect(paths()).toEqual(['First.md'])

    await useApp.getState().syncNow()
    expect(paths()).toEqual(['dropped.md', 'First.md'])
  })

  it('shows the new bytes when the open note changes underneath it', async () => {
    const path = await useApp.getState().createNote('Ossian')
    await useApp.getState().open(path)

    await outside.write(path, encodeText('edited in Obsidian\n'))
    await useApp.getState().syncNow()
    expect(useApp.getState().content).toBe('edited in Obsidian\n')
    expect(useApp.getState().unsaved).toBe(false)
  })

  it('never puts them over unsaved typing', async () => {
    const path = await useApp.getState().createNote('Ossian')
    await useApp.getState().open(path)

    useApp.getState().edit('typed here and not saved yet\n')
    await outside.write(path, encodeText('edited in Obsidian\n'))
    await useApp.getState().syncNow()
    // The one copy nobody else has.
    expect(useApp.getState().content).toBe('typed here and not saved yet\n')

    // Flushed here rather than left to the debounce, so the test leaves no
    // timer behind — and this is what typing winning actually means.
    await useApp.getState().save()
    expect((await outside.read(path)).byteLength).toBe(
      encodeText('typed here and not saved yet\n').byteLength,
    )
  })

  it('closes a note that was deleted from under it', async () => {
    const path = await useApp.getState().createNote('Gone')
    await useApp.getState().open(path)

    await outside.delete(path)
    await useApp.getState().syncNow()
    expect(useApp.getState().currentPath).toBeUndefined()
    expect(useApp.getState().content).toBe('')
    expect(paths()).toEqual([])
  })

  it('does not lose the editor to a rescan landing mid-rename', async () => {
    const path = await useApp.getState().createNote('Ossian')
    await useApp.getState().open(path)

    // The tick fires between the old path being deleted and the new one
    // reaching the screen — a window a rename with links to rewrite holds
    // open for as long as the rewriting takes. From inside it the note looks
    // deleted, because it is.
    const original = IdbVaultStore.prototype.delete
    const del = vi
      .spyOn(IdbVaultStore.prototype, 'delete')
      .mockImplementationOnce(async function (this: IdbVaultStore, gone: string) {
        await original.call(this, gone)
        await useApp.getState().syncNow()
      })

    await useApp.getState().renameNote(path, 'Fingal.md')
    expect(useApp.getState().currentPath).toBe('Fingal.md')
    expect(useApp.getState().content).toContain('Ossian')
    del.mockRestore()
  })

  it('keeps showing the notes when the vault cannot be read', async () => {
    await useApp.getState().createNote('Kept')

    // A folder that has been renamed, unplugged, or whose permission lapsed.
    const listing = vi
      .spyOn(IdbVaultStore.prototype, 'list')
      .mockRejectedValueOnce(new Error('no longer on disk'))
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useApp.getState().syncNow()

    // An empty note list reads as "your notes are gone", and this runs on a
    // timer: the same sentence in the notice strip every thirty seconds is
    // worse than the console.
    expect(paths()).toEqual(['Kept.md'])
    expect(useApp.getState().notices).toEqual([])
    expect(useApp.getState().sync).toBe('local')
    expect(warned).toHaveBeenCalled()

    listing.mockRestore()
    warned.mockRestore()
  })
})
