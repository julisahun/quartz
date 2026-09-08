/**
 * The rules behind the paths in the contract.
 *
 * `NoteRef.title` and `NoteRef.folder` are not free-form — they are these two
 * functions, and `taggedWith` compares tags the way the third one says. The
 * app has its own copies, in `state/notes.ts` and `state/tags.ts`, where the
 * rest of the app can reach them; `contract.test.ts` there fails if the two
 * ever disagree. Declared twice rather than shared so this package installs
 * on its own, with nothing of the app behind it.
 */

/** A note's title: the basename, without the `.md`. */
export function noteTitle(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.replace(/\.md$/i, '')
}

/** The containing folder, or `''` at the root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** How two tags are compared: `#PNJ` and `#pnj` are the same tag. */
export function tagKey(tag: string): string {
  return tag.toLowerCase()
}
