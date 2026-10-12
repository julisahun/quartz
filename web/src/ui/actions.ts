import { addCommand } from '../state/commands'
import { childFolder, folderName, folderNameProblem } from '../state/folders'
import { folderOf, isConflictCopy, isNote, noteTitle } from '../state/notes'
import { FolderTakenError, useApp, type HeldFile } from '../state/store'
import { isLocal, slugForVault } from '../state/vaults'
import { ApiError, OfflineError } from '../api/client'
import { askConfirm, askPassword, openMenu, askText, type MenuItem } from './dialogs'
import { shortcut } from './media'

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

/**
 * A new note, in `folder` — by default the folder of the note that is open,
 * which is where somebody working in a corner of the vault means.
 */
export async function promptNewNote(folder?: string): Promise<string | undefined> {
  const where = folder ?? folderOf(useApp.getState().currentPath ?? '')
  const title = await askText({
    title: where ? `New note in ${folderName(where)}` : 'New note',
    label: 'Title',
    confirmLabel: 'Create',
  })
  if (title === null) return undefined
  return useApp.getState().createNote(title, where)
}

/**
 * Asks whether the links to a note should follow it somewhere else. Only
 * worth asking when there is something to decide, so a note nothing links to
 * answers `false` without a sheet. Undefined means the sheet was dismissed,
 * which is not a quiet yes to either: nothing should move.
 */
async function askUpdateLinks(path: string, verb: 'Rename' | 'Move'): Promise<boolean | undefined> {
  const linking = await useApp.getState().linksTo(path)
  if (linking === 0) return false
  let chosen: boolean | undefined
  const picked = await openMenu(
    `${linking} ${linking === 1 ? 'note links' : 'notes link'} to ${noteTitle(path)}`,
    [
      {
        label: `${verb} and update them`,
        hint: 'The links follow the note',
        run: () => {
          chosen = true
        },
      },
      {
        label: `${verb} only`,
        hint: 'Those links may stop resolving',
        run: () => {
          chosen = false
        },
      },
    ],
  )
  if (!picked) return undefined
  return chosen
}

/** The extension a renamed file keeps: `.md` for a note, its own for anything else. */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

/**
 * Renaming a note asks for a name, the way renaming a folder does — not for
 * a path. The folder stays where it is and the extension is kept, so a typo
 * cannot move the note or turn it into something that is not a note; moving
 * is "Move to…", which asks with a list of folders instead.
 */
export async function promptRename(path: string): Promise<string | undefined> {
  const ext = extensionOf(path)
  const current = isNote(path) ? noteTitle(path) : noteTitle(path).slice(0, -ext.length || undefined)
  let value = current
  let problem: string | undefined

  for (;;) {
    const next = await askText({
      title: `Rename ${noteTitle(path)}`,
      label: problem ?? 'Name',
      value,
      confirmLabel: 'Rename',
    })
    if (next === null) return undefined
    value = next
    const name = next.trim().replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '')
    if (name === current) return undefined
    problem = nameProblem(name)
    if (problem) continue

    const folder = folderOf(path)
    const target = `${folder ? `${folder}/` : ''}${name}${ext}`
    const updateLinks = await askUpdateLinks(path, 'Rename')
    if (updateLinks === undefined) return undefined
    return useApp.getState().renameNote(path, target, updateLinks)
  }
}

function nameProblem(name: string): string | undefined {
  if (name === '') return 'A note needs a name.'
  if (name.includes('/')) return 'A name cannot contain / — use Move to… to change folders.'
  return folderNameProblem(name)?.replace('A folder name', 'A name')
}

/** Every folder in the vault, outermost first. */
function allFolders(): string[] {
  const found = new Set<string>()
  for (const file of useApp.getState().files) {
    let folder = folderOf(file.path)
    while (folder) {
      found.add(folder)
      folder = folderOf(folder)
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Moves a file into `folder` ('' for the root), asking about links first. */
export async function moveTo(path: string, folder: string): Promise<string | undefined> {
  if (folderOf(path) === folder) return undefined
  const name = path.slice(path.lastIndexOf('/') + 1)
  const updateLinks = await askUpdateLinks(path, 'Move')
  if (updateLinks === undefined) return undefined
  try {
    const moved = await useApp.getState().renameNote(path, folder ? `${folder}/${name}` : name, updateLinks)
    useApp.getState().notify('info', `${noteTitle(path)} moved to ${folder ? folderName(folder) : 'the vault root'}`)
    return moved
  } catch (err) {
    useApp.getState().notify('error', message(err, `${noteTitle(path)} was not moved.`))
    return undefined
  }
}

/** "Move to…": the folders as a list to pick from, rather than a path to type. */
export async function promptMove(path: string): Promise<string | undefined> {
  const here = folderOf(path)
  let target: string | undefined
  const choices: MenuItem[] = [
    ...(here ? [{ label: 'Vault root', hint: 'Out of every folder', run: () => (target = '') }] : []),
    ...allFolders()
      .filter((folder) => folder !== here)
      .map((folder) => ({
        label: folderName(folder),
        hint: folderOf(folder) || undefined,
        run: () => (target = folder),
      })),
  ]
  if (choices.length === 0) {
    useApp.getState().notify('info', 'There is no other folder to move it to yet.')
    return undefined
  }
  const picked = await openMenu(`Move ${noteTitle(path)} to…`, choices)
  if (!picked || target === undefined) return undefined
  return moveTo(path, target)
}

/** A notice that can put held files back. */
function offerUndo(text: string, held: HeldFile[]) {
  useApp.getState().notify(
    'info',
    text,
    held.length > 0
      ? { label: 'Undo', run: () => useApp.getState().restoreFiles(held) }
      : undefined,
  )
}

export async function promptDelete(path: string): Promise<boolean> {
  const ok = await askConfirm({
    title: `Delete ${noteTitle(path)}?`,
    body: 'You can undo this for a few seconds afterwards.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return false
  const held = await useApp.getState().holdFiles([path])
  await useApp.getState().deleteNote(path)
  offerUndo(`${noteTitle(path)} deleted`, held)
  return true
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
// The words are the UI's language, English; only the date takes the device's format.
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "3 hours ago", in the coarsest unit that is not zero. */
export function ago(at: number, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

/**
 * "History…": the server's saved versions of a note, and putting one back.
 *
 * Commits are debounced on the server, so a version is a resting point rather
 * than every keystroke. Restoring goes through the editor, which makes it an
 * ordinary edit — ⌘Z takes it back.
 */
export async function promptHistory(path: string): Promise<void> {
  const asking = useApp.getState().history(path)
  if (!asking) return
  let entries
  try {
    entries = await asking
  } catch (err) {
    useApp.getState().notify('error', message(err, 'The history could not be fetched. Is the server reachable?'))
    return
  }
  if (entries.length === 0) {
    useApp.getState().notify('info', `The server has no saved versions of ${noteTitle(path)} yet.`)
    return
  }
  let rev: string | undefined
  let at = 0
  const picked = await openMenu(
    `Versions of ${noteTitle(path)}`,
    entries.map((entry, i) => ({
      label: dateFormat.format(entry.at),
      hint: i === 0 ? `${ago(entry.at)} · the latest on the server` : ago(entry.at),
      run: () => {
        rev = entry.rev
        at = entry.at
      },
    })),
  )
  if (!picked || !rev) return
  const ok = await askConfirm({
    title: 'Restore this version?',
    body: `${noteTitle(path)} goes back to how it was on ${dateFormat.format(at)}. The text it has now is replaced${useApp.getState().currentPath === path ? ' — ⌘Z in the editor brings it back' : ''}.`,
    confirmLabel: 'Restore',
  })
  if (!ok) return
  try {
    await useApp.getState().restoreRevision(path, rev)
    useApp.getState().notify('info', `${noteTitle(path)} restored to ${dateFormat.format(at)}`)
  } catch (err) {
    useApp.getState().notify('error', message(err, 'That version could not be restored.'))
  }
}

function canAskHistory(): boolean {
  const { currentVault, vaults } = useApp.getState()
  const vault = vaults.find((v) => v.id === currentVault)
  return vault !== undefined && !isLocal(vault)
}

/** The note a conflict copy was split from: `Plan (conflict laptop 2026-…).md` → `Plan.md`. */
export function originalOf(path: string): string {
  return path.replace(/ \(conflict [^)]+\)(\.[^.]+)$/, '$1')
}

/**
 * A conflict copy is the other side of an edit made in two places. Settling
 * it means picking a side: this copy's text becomes the note, or the copy
 * goes. Either way the loser can be brought back with Undo.
 */
export async function promptResolveConflict(path: string): Promise<void> {
  const original = originalOf(path)
  const hasOriginal = useApp.getState().files.some((f) => f.path === original)
  let choice: 'mine' | 'theirs' | 'open' | undefined
  const picked = await openMenu(`Settle ${noteTitle(path)}`, [
    ...(hasOriginal
      ? [{ label: `Open ${noteTitle(original)}`, hint: 'To compare the two first', run: () => (choice = 'open') }]
      : []),
    {
      label: 'Keep this copy',
      hint: hasOriginal ? `Its text replaces ${noteTitle(original)}, and the copy goes` : `It becomes ${noteTitle(original)}`,
      run: () => (choice = 'mine'),
    },
    ...(hasOriginal
      ? [{ label: 'Keep the original', hint: 'This copy is deleted', danger: true, run: () => (choice = 'theirs') }]
      : []),
  ])
  if (!picked || !choice) return
  const app = useApp.getState()
  if (choice === 'open') {
    await app.open(original)
    return
  }
  const held = await app.holdFiles(choice === 'mine' ? [path, original] : [path])
  if (choice === 'mine') {
    const mine = held.find((file) => file.path === path)
    if (!mine) return
    await app.restoreFiles([{ path: original, data: mine.data }])
  }
  await app.deleteNote(path)
  await app.open(original)
  offerUndo(choice === 'mine' ? `${noteTitle(original)} now has the copy’s text` : 'Conflict copy deleted', held)
}

/**
 * What can be done to one file: the same list behind a row's context menu,
 * the note header's ⋯ and the phone's note menu, so all three agree.
 */
export function fileActions(path: string, options: { onDeleted?: () => void } = {}): MenuItem[] {
  return [
    ...(isConflictCopy(path)
      ? [{ label: 'Settle conflict…', hint: 'Keep this copy or the original', run: () => void promptResolveConflict(path) }]
      : []),
    { label: 'Rename…', run: () => void promptRename(path) },
    { label: 'Move to…', run: () => void promptMove(path) },
    ...(isNote(path) && canAskHistory()
      ? [{ label: 'History…', hint: 'Earlier versions saved on the server', run: () => void promptHistory(path) }]
      : []),
    {
      label: 'Delete',
      danger: true,
      run: () => void promptDelete(path).then((done) => done && options.onDeleted?.()),
    },
  ]
}

/** A row's context menu: the file's actions, with opening it first. */
export function rowMenu(path: string, onOpen: (path: string) => void): Promise<unknown> {
  return openMenu(noteTitle(path), [{ label: 'Open', run: () => onOpen(path) }, ...fileActions(path)])
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
    body: `${what} inside will be deleted. You can undo this for a few seconds afterwards.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return false

  try {
    const app = useApp.getState()
    const held = await app.holdFiles(app.files.filter((f) => f.path.startsWith(`${folder}/`)).map((f) => f.path))
    const gone = await app.deleteFolder(folder)
    offerUndo(`${folderName(folder)} deleted; ${count(gone, 'file')} gone`, held)
    return true
  } catch (err) {
    useApp.getState().notify('error', message(err, `${folderName(folder)} was not deleted.`))
    return false
  }
}

/** What a folder row's ⋯ offers. */
export function folderMenu(folder: string): Promise<unknown> {
  return openMenu(folderName(folder), [
    { label: 'New note here…', run: () => void promptNewNote(folder) },
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
    title: 'Publish to the server',
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
    confirmLabel: 'Forget vault',
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
    addCommand({ id: 'note.new', title: 'New note…', shortcut: shortcut('N'), run: () => void promptNewNote() }),
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
      id: 'note.move',
      title: 'Move this note to…',
      when: withNote,
      run: () => void promptMove(useApp.getState().currentPath!),
    }),
    addCommand({
      id: 'note.history',
      title: 'Show this note’s history…',
      when: () => withNote() && isNote(useApp.getState().currentPath!) && canAskHistory(),
      run: () => void promptHistory(useApp.getState().currentPath!),
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
