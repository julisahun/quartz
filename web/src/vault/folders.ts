import {
  ensureFsaAccess,
  forgetFsaFolder,
  fsaAccessGranted,
  fsaSupported,
  listFsaFolders,
  pickFsaFolder,
  promoteFsaFolder,
} from './fsa-bridge'
import {
  forgetLocalVault,
  isDesktop,
  localVaults,
  pickLocalVault,
  promoteLocalVault,
} from './tauri-bridge'

/**
 * Folders opened from disk, wherever the app is running.
 *
 * Two things can hand out a folder — the desktop shell through Tauri, and a
 * Chromium browser through the File System Access API — and they differ in
 * what they can promise. The shell knows the path and needs no permission; the
 * browser knows neither, and has to ask again after a restart. Everything
 * above here works in terms of a folder, not of which one answered.
 */

export interface Folder {
  id: string
  name: string
  /** Where it sits on disk, when whoever opened it can say. A browser cannot. */
  path?: string
  /**
   * True once promoted. The folder is then where a *synced* vault's bytes live
   * on this machine, under the id the server gave it — no longer a vault of
   * its own.
   */
  synced: boolean
}

/**
 * Every id whose bytes live in a real folder, promoted or not.
 *
 * Kept in memory because choosing a vault's store has to be synchronous while
 * both registries are asynchronous. It is written on every read of them, which
 * is the only way an id gets into the app at all.
 */
const backed = new Set<string>()

function remember(folders: Folder[]): Folder[] {
  for (const folder of folders) backed.add(folder.id)
  return folders
}

/** Whether this vault's notes live in a folder rather than in browser storage. */
export function isFolderBacked(id: string): boolean {
  return isDesktop() || backed.has(id)
}

/** Whether this build can open a folder from disk at all. */
export function foldersSupported(): boolean {
  return isDesktop() || fsaSupported()
}

export async function listFolders(): Promise<Folder[]> {
  return remember(isDesktop() ? await localVaults() : await listFsaFolders())
}

/** Asks for a folder. Undefined means the picker was dismissed. */
export async function pickFolder(): Promise<Folder | undefined> {
  const picked = isDesktop() ? await pickLocalVault() : await pickFsaFolder()
  if (picked) remember([picked])
  return picked
}

/**
 * Re-keys a folder to the id its vault was given on the server. Called after
 * the vault exists, so a failure here leaves a vault nobody is filling rather
 * than a folder pointing at nothing.
 */
export async function promoteFolder(id: string, newId: string): Promise<Folder> {
  const promoted = isDesktop()
    ? await promoteLocalVault(id, newId)
    : await promoteFsaFolder(id, newId)
  backed.delete(id)
  remember([promoted])
  return promoted
}

/** Stops listing a folder. Neither implementation touches what is in it. */
export async function forgetFolder(id: string): Promise<void> {
  if (isDesktop()) await forgetLocalVault(id)
  else await forgetFsaFolder(id)
  backed.delete(id)
}

/**
 * Whether the folder can be opened right now without asking anyone. The shell
 * holds a path and can always answer yes; a browser holds a permission that
 * usually lapses when the tab closes.
 */
export async function accessGranted(id: string): Promise<boolean> {
  return isDesktop() ? true : fsaAccessGranted(id)
}

/**
 * The same, but letting the browser prompt if it has to — so it belongs on the
 * path of a click, never on a launch.
 */
export async function ensureAccess(id: string): Promise<boolean> {
  return isDesktop() ? true : ensureFsaAccess(id)
}
