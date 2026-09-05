/**
 * The storage seam.
 *
 * The sync engine and the editor talk only to this interface. IndexedDB
 * implements it in the browser; Tauri implements it against a real folder on
 * the desktop. Keeping every storage call behind here is what makes the
 * desktop shell a wrapper rather than a rewrite (plan section 4.5).
 */

export interface FileMeta {
  path: string
  /** sha256 of the local bytes, hex — the same hash the server uses as an ETag. */
  hash: string
  size: number
  /** Unix milliseconds of the last local write. */
  mtime: number
}

export interface FileRecord extends FileMeta {
  /** The hash the server last confirmed. Empty when the server has never seen it. */
  baseHash: string
  /** Deleted locally, with the delete not yet pushed. */
  deleted: boolean
}

export type PendingOp =
  | { op: 'put'; path: string; baseHash: string }
  | { op: 'del'; path: string; baseHash: string }

export interface VaultStore {
  /** Every file held locally, tombstones excluded. */
  list(): Promise<FileMeta[]>
  read(path: string): Promise<Uint8Array>
  /** A local edit: stores the bytes and leaves the file dirty until pushed. */
  write(path: string, data: Uint8Array): Promise<void>
  /** A local delete: keeps a tombstone so the delete can still be pushed. */
  delete(path: string): Promise<void>
  /** Everything waiting to go to the server, oldest path first. */
  pending(): Promise<PendingOp[]>

  // --- Beyond the five: what the sync engine needs to track server state. ---

  meta(path: string): Promise<FileRecord | undefined>
  /** A server-authoritative write: stores the bytes and marks the file clean. */
  applyRemote(path: string, data: Uint8Array, hash: string): Promise<void>
  /** The server says this file is gone; drop it locally without a tombstone. */
  removeRemote(path: string): Promise<void>
  /** A push succeeded: the server now holds this hash. */
  markPushed(path: string, hash: string): Promise<void>
  /** A tombstone has been pushed (or is moot); forget the file entirely. */
  forget(path: string): Promise<void>

  cursor(): Promise<number>
  setCursor(seq: number): Promise<void>
  flag(key: string): Promise<string | undefined>
  setFlag(key: string, value: string): Promise<void>
  /** Wipe everything — used when the server's journal has been rebuilt. */
  clear(): Promise<void>
}

export const textDecoder = new TextDecoder()
export const textEncoder = new TextEncoder()

export function decodeText(data: Uint8Array): string {
  return textDecoder.decode(data)
}

export function encodeText(text: string): Uint8Array {
  return textEncoder.encode(text)
}
