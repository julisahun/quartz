import type { FileMeta } from '../vault/types'

/**
 * Folders, which nothing stores.
 *
 * A folder exists here because a file's path has it in the middle: `dnd` is a
 * folder because `dnd/Ossian.md` exists, and it stops being one when the last
 * file leaves. That is the whole model, and three things follow from it —
 * renaming a folder is a move of every file under it, deleting one is a delete
 * of every file under it, and an empty folder cannot be made to last, because
 * there would be nothing to remember it by.
 *
 * Both stores that have real directories prune the ones a delete leaves empty
 * (`vault.rs`, and `pruneEmptyDirs` on the server), so nothing here has to
 * make or remove a directory. Moving the last file out is what makes the old
 * folder go away.
 */

/**
 * Every file under `folder`, at any depth — attachments included.
 *
 * Not `isOpenable`: the tree lists notes and PDFs, but a folder also holds the
 * screenshots pasted into them, and a rename that moved only what was on
 * screen would leave those behind pointing at nothing.
 */
export function filesIn(files: FileMeta[], folder: string): FileMeta[] {
  const prefix = `${folder}/`
  return files.filter((file) => file.path.startsWith(prefix))
}

/** True when some file's path puts `folder` in the middle. Case-insensitive. */
export function folderExists(files: FileMeta[], folder: string): boolean {
  const prefix = `${folder.toLowerCase()}/`
  return files.some((file) => file.path.toLowerCase().startsWith(prefix))
}

/** `dnd/Ossian.md`, with `dnd` renamed to `campaign`, is `campaign/Ossian.md`. */
export function movedPath(path: string, from: string, to: string): string {
  return `${to}${path.slice(from.length)}`
}

/** The folder holding this one: `a/b/c` → `a/b`, and `a` → `''`. */
export function parentFolder(folder: string): string {
  const cut = folder.lastIndexOf('/')
  return cut < 0 ? '' : folder.slice(0, cut)
}

/** The last segment: what a person calls the folder. */
export function folderName(folder: string): string {
  return folder.slice(folder.lastIndexOf('/') + 1)
}

/** The path `folder` would have if its own name became `name`. */
export function renamedFolder(folder: string, name: string): string {
  const parent = parentFolder(folder)
  return parent ? `${parent}/${name}` : name
}

/** A path under `parent`, which may be the root. */
export function childFolder(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/**
 * Characters no path may carry, matching what `pathForTitle` strips out of a
 * note title. A folder whose name held a `/` would not be one folder.
 */
const BAD_CHARS = /[\\/:*?"<>|]/

/**
 * What is wrong with a folder name, said the way it would be shown, or
 * undefined when it is fine.
 *
 * Deliberately a name and not a path: renaming asks what to call the folder,
 * so it stays where it is and cannot be moved inside itself by typing.
 */
export function folderNameProblem(name: string): string | undefined {
  const trimmed = name.trim()
  if (trimmed === '') return 'A folder needs a name.'
  if (BAD_CHARS.test(trimmed)) return 'A folder name cannot contain \\ / : * ? " < > or |.'
  if (trimmed === '.' || trimmed === '..') return `“${trimmed}” is not a name a folder can have.`
  // The reserved prefix, and the two directories the ignore rules drop. A
  // folder under one of these would be invisible the moment it was made.
  if (trimmed.startsWith('.quartz')) return '“.quartz” is reserved for Quartz’s own files.'
  if (trimmed === '.git' || trimmed === '.trash') return `“${trimmed}” is not part of a vault.`
  return undefined
}

/** Whether two paths differ only in capitalisation. */
export function sameNameDifferentCase(from: string, to: string): boolean {
  return from !== to && from.toLowerCase() === to.toLowerCase()
}

/**
 * A folder path near `folder` that no file is under.
 *
 * Used for the one case a move cannot do in a single pass: renaming `dnd` to
 * `DND` on a case-insensitive filesystem writes the new file over the old one,
 * and the delete that follows would then take the file that was just written.
 * Going through a name that differs by more than case makes both halves of the
 * move unambiguous on either kind of filesystem.
 */
export function stagingFolder(files: FileMeta[], folder: string): string {
  for (let i = 1; i < 500; i++) {
    const candidate = `${folder} (renaming${i === 1 ? '' : ` ${i}`})`
    if (!folderExists(files, candidate)) return candidate
  }
  return `${folder} (renaming ${Date.now()})`
}
