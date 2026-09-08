import { addCommand } from '../state/commands'
import { childFolder, folderName, folderNameProblem } from '../state/folders'
import { folderOf, noteTitle } from '../state/notes'
import { FolderTakenError, useApp } from '../state/store'
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
 * Renaming a folder.
 *
 * Asks for a name rather than a path, so the folder cannot be moved somewhere
 * else — or inside itself — by typing. A name that is already taken, or that
 * no path could carry, is said back and the question asked again, because the
 * answer is a small correction rather than a reason to start over.
 */
export async function promptRenameFolder(folder: string): Promise<string | undefined> {
  let value = folderName(folder)
  let problem: string | undefined

  for (;;) {
    const next = await askText({
      title: `Rename ${folderName(folder)}`,
      label: problem ?? 'Folder name',
      value,
      confirmLabel: 'Rename',
    })
    if (next === null) return undefined
    value = next
    if (next.trim() === folderName(folder)) return undefined

    problem = folderNameProblem(next)
    if (problem) continue

    try {
      const done = await useApp.getState().renameFolder(folder, next)
      if (done.rewritten > 0) {
        const notes = `${done.rewritten} note${done.rewritten === 1 ? '' : 's'}`
        useApp
          .getState()
          .notify('info', `${folderName(folder)} is now ${next.trim()}; ${notes} updated`)
      }
      return done.path
    } catch (err) {
      if (err instanceof FolderTakenError) {
        problem = err.message
        continue
      }
      useApp.getState().notify('error', message(err, `${folderName(folder)} was not renamed.`))
      return undefined
    }
  }
}

/**
 * Making a folder, which means making a note in it.
 *
 * A folder here exists because a file's path has it in the middle, so an empty
 * one has nothing to be remembered by — it would vanish on the next launch and
 * never reach another device. Rather than pretend otherwise, this creates the
 * folder and the first note together and opens it, which is what the folder
 * was being made for.
 */
export async function promptNewFolder(parent = ''): Promise<string | undefined> {
  let value = ''
  let problem: string | undefined

  for (;;) {
    const next = await askText({
      title: parent ? `New folder in ${folderName(parent)}` : 'New folder',
      label: problem ?? 'Folder name',
      value,
      confirmLabel: 'Create',
    })
    if (next === null) return undefined
    value = next

    problem = folderNameProblem(next)
    if (problem) continue

    const folder = childFolder(parent, next.trim())
    if (useApp.getState().folderContents(folder).files > 0) {
      problem = `A folder called ${next.trim()} is already here.`
      continue
    }

    try {
      // The folder and its first note in one go: the note is what makes the
      // folder exist, so it is not a separate step anyone could skip.
      return await useApp.getState().createNote('Untitled', folder)
    } catch (err) {
      useApp.getState().notify('error', message(err, `${next.trim()} was not created.`))
      return undefined
    }
  }
}

/**
 * Deleting a folder, which deletes everything in it.
 *
 * The one genuinely destructive folder operation, so the count is in the
 * question and the count is of *files* — a folder holds the screenshots pasted
 * into its notes as well as the notes, and they go too.
 */
export async function promptDeleteFolder(folder: string): Promise<boolean> {
  const { files, notes } = useApp.getState().folderContents(folder)
  if (files === 0) return false

  const others = files - notes
  const what =
    others > 0
      ? `${count(notes, 'note')} and ${count(others, 'other file')}`
      : count(notes, 'note')

  const ok = await askConfirm({
    title: `Delete ${folderName(folder)}?`,
    body: `${what} inside will be deleted. They stay in the vault's git history, so they can be brought back over SSH.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return false

  try {
    const gone = await useApp.getState().deleteFolder(folder)
    useApp.getState().notify('info', `${folderName(folder)} deleted; ${count(gone, 'file')} gone`)
    return true
  } catch (err) {
    useApp.getState().notify('error', message(err, `${folderName(folder)} was not deleted.`))
    return false
  }
}

/** What a folder row's ⋯ offers. */
export function folderMenu(folder: string): Promise<unknown> {
  return openMenu(folderName(folder), [
    { label: 'Rename…', run: () => void promptRenameFolder(folder) },
    { label: 'New folder inside…', run: () => void promptNewFolder(folder) },
    { label: 'Delete', danger: true, run: () => void promptDeleteFolder(folder) },
  ])
}

function count(n: number, thing: string): string {
  return `${n} ${thing}${n === 1 ? '' : 's'}`
}

/** An error worth showing, or the fallback when it is not one. */
function message(err: unknown, fallback: string): string {
  if (err instanceof OfflineError) return fallback
  return err instanceof Error && err.message ? err.message : fallback
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
    // A folder at the root has no row of its own, and the sidebar's ⋯ is only
    // on a phone — so this is the one way to make one on a desktop.
    addCommand({ id: 'folder.new', title: 'New folder…', run: () => void promptNewFolder() }),
    addCommand({
      id: 'folder.rename',
      title: 'Rename this note’s folder…',
      when: () => folderOf(useApp.getState().currentPath ?? '') !== '',
      run: () => void promptRenameFolder(folderOf(useApp.getState().currentPath!)),
    }),
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
