import { noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { askConfirm, askText, openMenu } from './dialogs'

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

  // Only worth asking when there is something to decide: a note nothing links
  // to is renamed without a second sheet.
  const linking = await useApp.getState().linksTo(path)
  let updateLinks = false
  if (linking > 0) {
    let chosen: boolean | undefined
    const picked = await openMenu(
      `${linking} ${linking === 1 ? 'note links' : 'notes link'} to ${noteTitle(path)}`,
      [
        {
          label: 'Rename and update them',
          hint: 'The links follow the new name',
          run: () => {
            chosen = true
          },
        },
        {
          label: 'Rename only',
          hint: 'Those links will stop resolving',
          run: () => {
            chosen = false
          },
        },
      ],
    )
    // Dismissing the sheet is not a quiet yes to either: nothing moves.
    if (!picked || chosen === undefined) return undefined
    updateLinks = chosen
  }

  return useApp.getState().renameNote(path, next, updateLinks)
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

/**
 * Forgetting a folder is not deleting it, and the wording has to make that
 * obvious: the notes are on disk where the user put them, untouched.
 */
export async function promptForgetFolder(id: string): Promise<void> {
  const folder = useApp.getState().vaults.find((v) => v.id === id)
  if (!folder) return
  const ok = await askConfirm({
    title: `Stop listing ${folder.name}?`,
    body: 'The folder and every note in it stay exactly where they are on disk. You can open it again whenever you like.',
    confirmLabel: 'Forget folder',
  })
  if (ok) await useApp.getState().forgetFolder(id)
}

export async function promptSignOut(): Promise<void> {
  const ok = await askConfirm({
    title: 'Sign out?',
    body: 'Your notes stay on this device. You will need your password to sync again.',
    confirmLabel: 'Sign out',
  })
  if (ok) await useApp.getState().logout()
}
