// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { FolderTakenError, useApp } from './store'

/**
 * Renaming and deleting folders, end to end through the real IndexedDB store.
 *
 * A folder is not stored anywhere — it exists because a file's path has it in
 * the middle — so every one of these operations is really a set of moves or
 * deletes, and the thing worth testing is that the set is complete and that
 * the links come out pointing at what they name.
 */

let vaultId = 0

/** A vault of its own per test, so nothing leaks between them. */
function freshVault(): void {
  vaultId += 1
  useApp.setState({
    phase: 'ready',
    user: 'tester',
    device: 'test-device',
    vaults: [{ id: `fv${vaultId}`, name: 'Test', owner: 'tester', role: 'owner' }],
    currentVault: `fv${vaultId}`,
    files: [],
    currentPath: undefined,
    content: '',
    unsaved: false,
    backlinks: [],
    notices: [],
    // IndexedDB needs real timers, so the action itself is what to stub.
    syncNow: async () => {},
  })
}

/** Creates a note in a folder, through the same calls the editor makes. */
async function write(title: string, folder: string, body: string): Promise<string> {
  const app = useApp.getState()
  const path = await app.createNote(title, folder)
  useApp.getState().edit(body)
  await useApp.getState().save()
  return path
}

async function read(path: string): Promise<string> {
  await useApp.getState().open(path)
  return useApp.getState().content
}

const paths = () => useApp.getState().files.map((f) => f.path).sort()

beforeEach(freshVault)

describe('renaming a folder', () => {
  it('moves everything under it, however deep', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Places', 'dnd/talasia', '# Places\n')
    await write('Inbox', '', '# Inbox\n')

    const done = await useApp.getState().renameFolder('dnd', 'campaign')

    expect(done.path).toBe('campaign')
    expect(done.moved).toBe(2)
    expect(paths()).toEqual(['Inbox.md', 'campaign/Ossian.md', 'campaign/talasia/Places.md'])
  })

  /**
   * The tree lists notes and PDFs, so a rename written against what is on
   * screen would leave the pasted screenshots behind, embedded from notes that
   * had moved. `attachments/` is the extreme of that: a folder with no notes
   * in it at all.
   */
  it('takes the files that are not notes', async () => {
    await write('Ossian', '', '# Ossian\n')
    const shot = await useApp.getState().attach(new File([new Uint8Array([1, 2, 3])], 'shot.png'))
    expect(shot.startsWith('attachments/')).toBe(true)

    const done = await useApp.getState().renameFolder('attachments', 'files')

    expect(done.moved).toBe(1)
    expect(paths().filter((path) => path.startsWith('files/'))).toHaveLength(1)
    expect(paths().some((path) => path.startsWith('attachments/'))).toBe(false)
  })

  /**
   * A folder rename changes no file's name, so a bare `[[link]]` resolves by
   * basename exactly as it did. Rewriting it would be a reformat, not a move.
   */
  it('leaves bare links completely alone', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Journal', '', 'met [[Ossian]] and [[Ossian#Voice|his voice]]\n')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(await read('Journal.md')).toBe('met [[Ossian]] and [[Ossian#Voice|his voice]]\n')
  })

  /**
   * A link that spelled the folder out is the one kind that goes stale. It
   * usually still resolves, by falling back to the basename, which is worse
   * than breaking: it reads as a path that is not there any more.
   */
  it('brings spelled-out links up to date', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Journal', '', 'see [[dnd/Ossian]] and [[dnd/Ossian#Voice|him]]\n')

    const done = await useApp.getState().renameFolder('dnd', 'campaign')

    expect(done.rewritten).toBe(1)
    expect(await read('Journal.md')).toBe(
      'see [[campaign/Ossian]] and [[campaign/Ossian#Voice|him]]\n',
    )
  })

  it('keeps a path link a path link, and an extension an extension', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Journal', '', 'see [[dnd/Ossian.md]]\n')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(await read('Journal.md')).toBe('see [[campaign/Ossian.md]]\n')
  })

  it('updates a link written inside the folder that moved', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Places', 'dnd', 'ruled by [[dnd/Ossian]]\n')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(await read('campaign/Places.md')).toBe('ruled by [[campaign/Ossian]]\n')
  })

  it('does not touch a link inside code', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Journal', '', 'a `[[dnd/Ossian]]` span\n\n```\n[[dnd/Ossian]]\n```\n')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(await read('Journal.md')).toBe('a `[[dnd/Ossian]]` span\n\n```\n[[dnd/Ossian]]\n```\n')
  })

  it('follows the open note to its new path', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await useApp.getState().open('dnd/Ossian.md')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(useApp.getState().currentPath).toBe('campaign/Ossian.md')
    expect(useApp.getState().content).toBe('# Ossian\n')
  })

  it('saves what is on screen before moving it', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await useApp.getState().open('dnd/Ossian.md')
    // Typed and not yet saved, the way a rename mid-sentence finds it.
    useApp.getState().edit('# Ossian\n\nhalf a sen')

    await useApp.getState().renameFolder('dnd', 'campaign')

    expect(await read('campaign/Ossian.md')).toBe('# Ossian\n\nhalf a sen')
  })

  it('renames a nested folder without moving it out', async () => {
    await write('Places', 'dnd/talasia', '# Places\n')

    const done = await useApp.getState().renameFolder('dnd/talasia', 'places')

    expect(done.path).toBe('dnd/places')
    expect(paths()).toEqual(['dnd/places/Places.md'])
  })

  it('refuses a name another folder already answers to', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Other', 'campaign', '# Other\n')

    await expect(useApp.getState().renameFolder('dnd', 'campaign')).rejects.toThrow(
      FolderTakenError,
    )
    // And nothing moved on the way to finding out.
    expect(paths()).toEqual(['campaign/Other.md', 'dnd/Ossian.md'])
  })

  it('refuses a name that differs from a taken one only in case', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Other', 'campaign', '# Other\n')

    await expect(useApp.getState().renameFolder('dnd', 'CAMPAIGN')).rejects.toThrow(
      FolderTakenError,
    )
  })

  /**
   * The case that loses notes if it is done in one pass: on a case-insensitive
   * filesystem the new file is the old file, so the delete that followed the
   * write would take what had just been written.
   */
  it('can change only the capitalisation of a folder', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Places', 'dnd/talasia', '# Places\n')

    const done = await useApp.getState().renameFolder('dnd', 'DND')

    expect(done.path).toBe('DND')
    expect(paths()).toEqual(['DND/Ossian.md', 'DND/talasia/Places.md'])
    expect(await read('DND/Ossian.md')).toBe('# Ossian\n')
  })

  it('does nothing when the name has not changed', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    const done = await useApp.getState().renameFolder('dnd', 'dnd')
    expect(done).toEqual({ path: 'dnd', moved: 0, rewritten: 0 })
    expect(paths()).toEqual(['dnd/Ossian.md'])
  })

  it('refuses a folder that holds nothing', async () => {
    await write('Inbox', '', '# Inbox\n')
    await expect(useApp.getState().renameFolder('dnd', 'campaign')).rejects.toThrow()
  })
})

describe('deleting a folder', () => {
  it('takes everything inside, and says how much', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Places', 'dnd/talasia', '# Places\n')
    await write('Inbox', '', '# Inbox\n')

    expect(await useApp.getState().deleteFolder('dnd')).toBe(2)
    expect(paths()).toEqual(['Inbox.md'])
  })

  it('closes the open note when it was one of them', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await useApp.getState().open('dnd/Ossian.md')

    await useApp.getState().deleteFolder('dnd')

    expect(useApp.getState().currentPath).toBeUndefined()
    expect(useApp.getState().content).toBe('')
  })

  it('leaves the open note alone when it was somewhere else', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Inbox', '', '# Inbox\n')
    await useApp.getState().open('Inbox.md')

    await useApp.getState().deleteFolder('dnd')

    expect(useApp.getState().currentPath).toBe('Inbox.md')
  })

  it('does not touch a folder whose name another one starts with', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Other', 'dnd-notes', '# Other\n')

    await useApp.getState().deleteFolder('dnd')

    expect(paths()).toEqual(['dnd-notes/Other.md'])
  })

  it('is nothing to do for a folder that holds nothing', async () => {
    expect(await useApp.getState().deleteFolder('dnd')).toBe(0)
  })
})

describe('what a folder holds', () => {
  it('counts the notes apart from everything else', async () => {
    await write('Ossian', 'dnd', '# Ossian\n')
    await write('Places', 'dnd/talasia', '# Places\n')

    expect(useApp.getState().folderContents('dnd')).toEqual({ files: 2, notes: 2 })
    expect(useApp.getState().folderContents('nowhere')).toEqual({ files: 0, notes: 0 })
  })
})
