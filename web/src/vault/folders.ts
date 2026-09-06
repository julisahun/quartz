import {
  ensureFsaAccess,
  forgetFsaFolder,
  fsaAccessGranted,
  fsaSupported,
  listFsaFolders,
  pickFsaFolder,
} from './fsa-bridge'
import { forgetLocalVault, isDesktop, localVaults, pickLocalVault } from './tauri-bridge'

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
}

/** Whether this build can open a folder from disk at all. */
export function foldersSupported(): boolean {
  return isDesktop() || fsaSupported()
}

export async function listFolders(): Promise<Folder[]> {
  return isDesktop() ? localVaults() : listFsaFolders()
}

/** Asks for a folder. Undefined means the picker was dismissed. */
export async function pickFolder(): Promise<Folder | undefined> {
  return isDesktop() ? pickLocalVault() : pickFsaFolder()
}

/** Stops listing a folder. Neither implementation touches what is in it. */
export async function forgetFolder(id: string): Promise<void> {
  return isDesktop() ? forgetLocalVault(id) : forgetFsaFolder(id)
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
