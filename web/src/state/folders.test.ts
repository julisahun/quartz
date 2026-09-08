import { describe, expect, it } from 'vitest'
import type { FileMeta } from '../vault/types'
import {
  childFolder,
  filesIn,
  folderExists,
  folderName,
  folderNameProblem,
  movedPath,
  parentFolder,
  renamedFolder,
  sameNameDifferentCase,
  stagingFolder,
} from './folders'

const files = (...paths: string[]): FileMeta[] =>
  paths.map((path) => ({ path, hash: 'h', size: 1, mtime: 0 }))

const vault = files(
  'dnd/Ossian.md',
  'dnd/talasia/Places.md',
  'dnd/talasia/map.png',
  'dnd/carta.pdf',
  'Inbox.md',
  'dnd-notes/Other.md',
)

describe('what a folder holds', () => {
  it('is everything under it, at any depth', () => {
    expect(filesIn(vault, 'dnd').map((f) => f.path)).toEqual([
      'dnd/Ossian.md',
      'dnd/talasia/Places.md',
      'dnd/talasia/map.png',
      'dnd/carta.pdf',
    ])
  })

  /**
   * The tree lists notes and PDFs, but a folder also holds the screenshots
   * pasted into its notes. A rename that moved only what was on screen would
   * leave those behind, pointing at nothing.
   */
  it('includes attachments the tree never shows', () => {
    expect(filesIn(vault, 'dnd/talasia').map((f) => f.path)).toContain('dnd/talasia/map.png')
  })

  it('does not mistake a folder for one whose name it starts with', () => {
    // `dnd-notes` is not inside `dnd`, however the strings sort.
    expect(filesIn(vault, 'dnd').map((f) => f.path)).not.toContain('dnd-notes/Other.md')
  })

  it('knows a folder by there being a file in it', () => {
    expect(folderExists(vault, 'dnd')).toBe(true)
    expect(folderExists(vault, 'dnd/talasia')).toBe(true)
    expect(folderExists(vault, 'campaign')).toBe(false)
    // Nothing records a folder, so one holding nothing is not there at all.
    expect(folderExists(files('Inbox.md'), 'dnd')).toBe(false)
  })

  it('matches a folder however it is capitalised', () => {
    // The check guards a rename against a collision, and on a
    // case-insensitive filesystem `DND` and `dnd` are the same folder.
    expect(folderExists(vault, 'DND')).toBe(true)
  })
})

describe('folder paths', () => {
  it('moves a file to the renamed folder', () => {
    expect(movedPath('dnd/talasia/Places.md', 'dnd', 'campaign')).toBe(
      'campaign/talasia/Places.md',
    )
    expect(movedPath('dnd/Ossian.md', 'dnd', 'campaign')).toBe('campaign/Ossian.md')
  })

  it('renames a nested folder without moving it', () => {
    expect(renamedFolder('dnd/talasia', 'places')).toBe('dnd/places')
    expect(renamedFolder('dnd', 'campaign')).toBe('campaign')
  })

  it('reads a folder’s parent and its own name', () => {
    expect(parentFolder('dnd/talasia')).toBe('dnd')
    expect(parentFolder('dnd')).toBe('')
    expect(folderName('dnd/talasia')).toBe('talasia')
    expect(folderName('dnd')).toBe('dnd')
  })

  it('puts a child under the root without a leading slash', () => {
    expect(childFolder('', 'dnd')).toBe('dnd')
    expect(childFolder('dnd', 'talasia')).toBe('dnd/talasia')
  })
})

describe('a folder name', () => {
  it('accepts an ordinary one', () => {
    expect(folderNameProblem('Campaign notes')).toBeUndefined()
    expect(folderNameProblem('2026-09')).toBeUndefined()
  })

  it('needs to be something', () => {
    expect(folderNameProblem('')).toBeTruthy()
    expect(folderNameProblem('   ')).toBeTruthy()
  })

  it('cannot carry a separator, or it would be two folders', () => {
    expect(folderNameProblem('dnd/talasia')).toBeTruthy()
    expect(folderNameProblem('dnd\\talasia')).toBeTruthy()
  })

  it('refuses the characters a path cannot hold', () => {
    for (const bad of [':', '*', '?', '"', '<', '>', '|']) {
      expect(folderNameProblem(`a${bad}b`), bad).toBeTruthy()
    }
  })

  it('refuses the names that mean a directory', () => {
    expect(folderNameProblem('.')).toBeTruthy()
    expect(folderNameProblem('..')).toBeTruthy()
  })

  /**
   * A folder under one of these would be invisible the moment it was made:
   * `.quartz*` is reserved and never synced, and the ignore rules drop `.git`
   * and `.trash` in all three implementations.
   */
  it('refuses what a vault does not consider part of itself', () => {
    expect(folderNameProblem('.quartz')).toBeTruthy()
    expect(folderNameProblem('.quartz-tmp')).toBeTruthy()
    expect(folderNameProblem('.git')).toBeTruthy()
    expect(folderNameProblem('.trash')).toBeTruthy()
    // A dotfolder that is not one of those is fine — Obsidian's own is.
    expect(folderNameProblem('.obsidian')).toBeUndefined()
  })
})

describe('renaming to the same name in different capitals', () => {
  it('is recognised', () => {
    expect(sameNameDifferentCase('dnd', 'DND')).toBe(true)
    expect(sameNameDifferentCase('dnd', 'dnd')).toBe(false)
    expect(sameNameDifferentCase('dnd', 'campaign')).toBe(false)
  })

  it('gets a staging name no file is under', () => {
    const staging = stagingFolder(vault, 'DND')
    expect(folderExists(vault, staging)).toBe(false)
    // More than case apart from both ends, which is the whole point of it.
    expect(staging.toLowerCase()).not.toBe('dnd')
  })

  it('steps the staging name past one that is taken', () => {
    const taken = files('DND (renaming)/a.md')
    expect(stagingFolder(taken, 'DND')).toBe('DND (renaming 2)')
  })
})
