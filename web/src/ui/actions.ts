import { addCommand } from '../state/commands'
import { noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { slugForVault } from '../state/vaults'
import { ApiError, OfflineError } from '../api/client'
import { askConfirm, askPassword, openMenu, askText } from './dialogs'

/**
 * The note actions that need to ask something first. One copy, so the phone's
 * overflow menu, the desktop status bar and a swiped row all behave alike.
 */

/**
 * Where a vault's notes should live on this machine, asked once per vault.
 *
 * "In the app" is offered first and reads as the lighter choice, because it is
 * the one that leaves nothing behind on a machine that is not yours. Keeping
 * it as files opens a picker, so it can be pointed at a copy of the notes that
 * is already there.
 */
export async function askWhereVaultLives(
  vaultName: string,
): Promise<'folder' | 'app' | undefined> {
  let answer: 'folder' | 'app' | undefined
  const chosen = await openMenu(`Where should ${vaultName} live on this machine?`, [
    {
      label: 'Keep it in the app',
      hint: 'Nothing lands in your filesystem',
      run: () => {
        answer = 'app'
      },
    },
    {
      label: 'Keep it as files…',
      hint: 'A folder Obsidian can open too',
      run: () => {
        answer = 'folder'
      },
    },
  ])
  chosen?.run()
  return answer
}

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
 * Publishing a folder. Two steps on purpose: the name decides the id, and the
 * id is shown back before anything is created, because nothing in the app
 * un-does this afterwards.
 */
export async function promptPromote(id: string): Promise<void> {
  const folder = useApp.getState().vaults.find((v) => v.id === id)
  if (!folder) return

  const name = await askText({
    title: 'Sync to the server',
    label: 'Name on the server',
    value: folder.name,
    confirmLabel: 'Continue',
  })
  if (name === null) return

  const slug = slugForVault(name)
  const ok = await askConfirm({
    title: `Publish ${name}?`,
    body: `A copy goes to the server as “${slug}”, and every device you sign in on can open it. The folder stays where it is. Nothing in the app undoes this.`,
    confirmLabel: 'Publish',
  })
  if (!ok) return
  await useApp.getState().promoteVault(id, name)
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

/**
 * Changing the password needs the current one, so this is not a way back in
 * for someone who has forgotten it — that is still `quartz-admin user passwd`
 * over SSH. Signing the other devices out is offered and defaults to on: a
 * session outlives the password it was opened with, so leaving them be would
 * make the change mean less than it looks.
 */
export async function promptChangePassword(): Promise<void> {
  await askPassword({
    title: 'Change password',
    async submit({ current, next, signOutOthers }) {
      try {
        await useApp.getState().changePassword({ current, next, signOutOthers })
        return null
      } catch (err) {
        return passwordFailure(err)
      }
    },
  })
}

function passwordFailure(err: unknown): string {
  if (err instanceof OfflineError) {
    return 'No connection to the server, so the password is unchanged.'
  }
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_credentials':
        return 'That is not your current password.'
      case 'password_too_short':
        return 'Use at least 8 characters.'
      case 'rate_limited':
        return 'Too many attempts. Try again in a few minutes.'
    }
    // A 401 for a *missing* session is a different thing from a wrong
    // password, and says so rather than blaming what was typed.
    if (err.isAuth) return 'Your session expired. Sign in again, then retry.'
  }
  return 'The password could not be changed.'
}

/**
 * The app's own commands.
 *
 * Registered rather than listed inside ⌘P, for the same reason the menus call
 * these functions instead of re-implementing them: one definition of what
 * "rename" is, wherever it is reached from. Called once, from `main.tsx`.
 */
export function registerNoteCommands(): () => void {
  const withNote = () => useApp.getState().currentPath !== undefined
  const signedIn = () => useApp.getState().signedIn

  const added = [
    addCommand({ id: 'note.new', title: 'New note…', run: () => void promptNewNote() }),
    addCommand({
      id: 'note.rename',
      title: 'Rename this note…',
      when: withNote,
      run: () => void promptRename(useApp.getState().currentPath!),
    }),
    addCommand({
      id: 'note.delete',
      title: 'Delete this note',
      when: withNote,
      run: () => void promptDelete(useApp.getState().currentPath!),
    }),
    addCommand({ id: 'vault.sync', title: 'Sync now', run: () => useApp.getState().syncNow() }),
    addCommand({
      id: 'account.password',
      title: 'Change password…',
      when: signedIn,
      run: () => void promptChangePassword(),
    }),
    addCommand({
      id: 'account.signout',
      title: 'Sign out',
      when: signedIn,
      run: () => void promptSignOut(),
    }),
  ]

  return () => {
    for (const remove of added) remove()
  }
}
