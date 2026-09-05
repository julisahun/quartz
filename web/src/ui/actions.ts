import { noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { askConfirm, askText } from './dialogs'

/**
 * The note actions that need to ask something first. One copy, so the phone's
 * overflow menu, the desktop status bar and a swiped row all behave alike.
 */

export async function promptNewNote(): Promise<string | undefined> {
  const title = await askText({ title: 'New note', label: 'Title', confirmLabel: 'Create' })
  if (title === null) return undefined
  return useApp.getState().createNote(title)
}

export async function promptRename(path: string): Promise<string | undefined> {
  const next = await askText({
    title: 'Rename',
    label: 'Path in the vault',
    value: path,
    confirmLabel: 'Rename',
  })
  if (next === null || next === path) return undefined
  return useApp.getState().renameNote(path, next)
}

export async function promptDelete(path: string): Promise<boolean> {
  const ok = await askConfirm({
    title: `Delete ${noteTitle(path)}?`,
    body: "It stays in the vault's git history, so it can be brought back over SSH.",
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return false
  await useApp.getState().deleteNote(path)
  return true
}

export async function promptSignOut(): Promise<void> {
  const ok = await askConfirm({
    title: 'Sign out?',
    body: 'Your notes stay on this device. You will need your password to sync again.',
    confirmLabel: 'Sign out',
  })
  if (ok) await useApp.getState().logout()
}
