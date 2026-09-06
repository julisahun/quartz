/**
 * The note list as the folders it actually is.
 *
 * A flat list grouped by full path was fine for a vault of a dozen notes and
 * unreadable for one where every note lives four folders deep — the headings
 * were longer than the titles under them. This turns the paths back into the
 * tree they came from; what is open and what is closed is the sidebar's
 * business, not this file's.
 *
 * It lists what the app can show: notes, and the PDFs filed beside them.
 */

import type { FileMeta } from '../vault/types'
import { isOpenable, isPdf, noteTitle } from './notes'

export interface TreeFolder {
  kind: 'folder'
  /** Full path from the vault root, e.g. `dnd/talasia`. */
  path: string
  name: string
  children: TreeNode[]
  /** Files anywhere inside, so a closed folder can say what it is holding. */
  count: number
}

export interface TreeFile {
  kind: 'file'
  path: string
  title: string
  /** A PDF is listed beside the notes but is not one, and says so. */
  pdf: boolean
}

export type TreeNode = TreeFolder | TreeFile

/** Folders before notes, each in the order a person would look for them. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildTree(files: FileMeta[]): TreeNode[] {
  const root: TreeFolder = { kind: 'folder', path: '', name: '', children: [], count: 0 }

  for (const file of files) {
    if (!isOpenable(file.path)) continue
    const parts = file.path.split('/')
    let folder = root
    for (const name of parts.slice(0, -1)) {
      folder.count++
      folder = childFolder(folder, name)
    }
    folder.count++
    folder.children.push({
      kind: 'file',
      path: file.path,
      title: noteTitle(file.path),
      pdf: isPdf(file.path),
    })
  }

  sort(root)
  return root.children
}

function childFolder(parent: TreeFolder, name: string): TreeFolder {
  const path = parent.path ? `${parent.path}/${name}` : name
  const existing = parent.children.find(
    (child): child is TreeFolder => child.kind === 'folder' && child.path === path,
  )
  if (existing) return existing
  const folder: TreeFolder = { kind: 'folder', path, name, children: [], count: 0 }
  parent.children.push(folder)
  return folder
}

function sort(folder: TreeFolder): void {
  folder.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(label(a), label(b))
  })
  for (const child of folder.children) {
    if (child.kind === 'folder') sort(child)
  }
}

function label(node: TreeNode): string {
  return node.kind === 'folder' ? node.name : node.title
}

/** Every folder on the way to a note: `a/b/c.md` → `a`, `a/b`. */
export function foldersTo(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}
