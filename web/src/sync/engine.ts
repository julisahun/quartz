import { ApiError, type Change, type VaultApi } from '../api/client'
import { sha256Hex } from '../vault/hash'
import type { FileMeta, VaultStore } from '../vault/types'
import { conflictPath } from './conflict'

export interface SyncStats {
  pulled: number
  pushed: number
  deleted: number
  conflicts: number
}

export interface SyncNotice {
  kind: 'conflict' | 'restored' | 'reset'
  path: string
  detail?: string
}

export interface SyncOptions {
  device: string
  onNotice?: (notice: SyncNotice) => void
}

const emptyStats = (): SyncStats => ({ pulled: 0, pushed: 0, deleted: 0, conflicts: 0 })

/**
 * The repair marker: a device whose stored value is not this one reconciles
 * against the manifest once, whatever its cursor claims.
 *
 * It exists because a client that skipped part of the journal cannot discover
 * that from the journal — its cursor says it is caught up, so the files it
 * missed stay missing, stale or deleted-elsewhere for good. Bumping this is
 * how a fix reaches damage the old code already did. Only bump it for damage
 * that needs the manifest to find; it costs every device one snapshot.
 */
const REPAIR = 'journal-gap-2026-09'

/**
 * The client half of plan section 4.4.
 *
 * Pull applies remote changes to files that are clean and leaves local work
 * alone; push sends each pending op under a precondition. A lost race keeps
 * both versions rather than picking a winner. Nothing here ever discards a
 * pending op because of an error — an interrupted sync is resumed, not
 * abandoned.
 */
export class SyncEngine {
  constructor(
    private readonly store: VaultStore,
    private readonly api: VaultApi,
    private readonly opts: SyncOptions,
  ) {}

  async sync(): Promise<SyncStats> {
    const stats = emptyStats()
    if (!(await this.store.flag('bootstrapped')) || (await this.store.flag('repair')) !== REPAIR) {
      await this.reconcile(stats)
    }
    await this.pull(stats)
    await this.push(stats)
    return stats
  }

  /**
   * Reconcile against the full manifest instead of the journal. Used on the
   * first sync, if the server's index was rebuilt and its sequence numbers
   * restarted, and by the repair pass above.
   *
   * Two-way on purpose: the manifest is the only thing that can tell a device
   * what it never heard about, so this has to answer for local files it does
   * not mention as well as for the files it does.
   */
  private async reconcile(stats: SyncStats): Promise<void> {
    const snap = await this.api.snapshot()
    const listed = new Set<string>()
    for (const remote of snap.files) {
      listed.add(remote.path)
      await this.reconcileFile(remote, stats)
    }
    // A manifest listing nothing is not evidence that everything was deleted.
    // The server creates a vault's directory if it is missing, so a disk that
    // failed to mount on the Pi produces an empty vault and an empty manifest
    // — and acting on that would delete a folder-backed vault off the user's
    // own disk. A real emptying still arrives as journal entries.
    if (listed.size > 0) await this.reconcileMissing(listed, stats)
    await this.store.setCursor(snap.head)
    await this.store.setFlag('epoch', snap.epoch)
    await this.store.setFlag('bootstrapped', '1')
    await this.store.setFlag('repair', REPAIR)
  }

  /** One file the manifest lists. */
  private async reconcileFile(remote: FileMeta, stats: SyncStats): Promise<void> {
    const local = await this.store.meta(remote.path)
    if (!local) {
      await this.download(remote.path)
      stats.pulled++
      return
    }
    if (local.deleted) {
      // A tombstone still waiting to be pushed. Same rule as the journal
      // path: our delete stands unless the file moved on after it.
      if (local.baseHash === remote.hash) return
      await this.download(remote.path)
      stats.conflicts++
      this.opts.onNotice?.({ kind: 'restored', path: remote.path })
      return
    }
    if (local.hash === remote.hash) {
      // Already the right bytes. Worth a write only if the base is behind,
      // which is what keeps a repair pass over a big vault cheap.
      if (local.baseHash !== remote.hash) await this.store.markPushed(remote.path, remote.hash)
      return
    }
    if (local.baseHash !== '' && local.hash === local.baseHash) {
      // Clean, and the server confirmed this version once: it has simply
      // moved on since. There is no local work here to keep, so a conflict
      // copy would be litter — this is the ordinary out-of-date file, and the
      // case a rebuilt index used to turn into a sidecar on every device.
      await this.download(remote.path)
      stats.pulled++
      return
    }
    // Edited here, or never pushed at all: no shared history to pick a winner
    // from, so keep both.
    const data = await this.store.read(remote.path)
    const copy = conflictPath(remote.path, this.opts.device)
    await this.store.write(copy, data)
    await this.download(remote.path)
    stats.conflicts++
    this.opts.onNotice?.({ kind: 'conflict', path: remote.path, detail: copy })
  }

  /**
   * Local files the manifest does not list.
   *
   * A first sync has none of these to worry about — everything local is a
   * local creation. A repair pass does: a delete this device never saw leaves
   * the file behind for good, because the journal entry that would have
   * removed it is behind the cursor. Only a clean, already-pushed file is
   * dropped; anything unsent is still ours to send.
   */
  private async reconcileMissing(listed: Set<string>, stats: SyncStats): Promise<void> {
    for (const file of await this.store.list()) {
      if (listed.has(file.path)) continue
      const local = await this.store.meta(file.path)
      if (!local || local.deleted) continue
      if (local.baseHash === '') continue // never pushed: push will create it
      if (local.hash !== local.baseHash) continue // edited here; an edit beats a delete
      await this.store.removeRemote(file.path)
      stats.deleted++
    }
  }

  private async pull(stats: SyncStats): Promise<void> {
    for (;;) {
      const cursor = await this.store.cursor()
      const page = await this.api.changes(cursor)

      const knownEpoch = await this.store.flag('epoch')
      if (page.epoch && knownEpoch && page.epoch !== knownEpoch) {
        // The server's index was rebuilt from the vault, so sequence numbers
        // restarted and our cursor points into a journal that no longer
        // exists. Fall back to the manifest.
        this.opts.onNotice?.({ kind: 'reset', path: '', detail: 'the server rebuilt its index' })
        await this.store.setCursor(0)
        await this.reconcile(stats)
        return
      }
      if (page.epoch && !knownEpoch) await this.store.setFlag('epoch', page.epoch)
      if (page.changes.length === 0) return // caught up
      for (const change of page.changes) {
        await this.applyChange(change, stats)
      }

      // The last entry actually applied — never the journal's head.
      //
      // A page that stops short of head leaves entries unread, and a cursor at
      // head would call them consumed: every file mentioned only in the gap
      // would stay missing, stale, or deleted-elsewhere on this device for
      // good, with nothing left to notice it by. Reading the cursor off the
      // page also means a server that miscounts `head` or `more` can cost a
      // round trip but never a file.
      const applied = page.changes[page.changes.length - 1].seq
      if (applied <= cursor) return // no forward progress; do not spin on it
      await this.store.setCursor(applied)
      if (!page.more) return
    }
  }

  private async applyChange(change: Change, stats: SyncStats): Promise<void> {
    const local = await this.store.meta(change.path)
    const exists = !!local && !local.deleted
    const locallyEdited = exists && local!.hash !== local!.baseHash
    const locallyDeleted = !!local && local.deleted

    if (change.op === 'put') {
      if (exists && local!.hash === change.hash) {
        await this.store.markPushed(change.path, change.hash!)
        return
      }
      if (locallyEdited) return // the push step resolves this as a conflict
      if (locallyDeleted && change.hash === local!.baseHash) return // our delete still stands

      await this.download(change.path)
      if (locallyDeleted) {
        // Someone edited the file after we deleted it: deletion loses to edit.
        stats.conflicts++
        this.opts.onNotice?.({ kind: 'restored', path: change.path })
      } else {
        stats.pulled++
      }
      return
    }

    if (locallyEdited) return // our edit beats the delete; push re-creates it
    if (exists) stats.deleted++
    await this.store.removeRemote(change.path)
  }

  private async download(path: string): Promise<void> {
    try {
      const { data, hash } = await this.api.getFile(path)
      // Never store a file with an unknown base hash: it would look like a
      // local creation on the next push, and creating a file the server
      // already has means a 412 and a conflict copy for nothing.
      await this.store.applyRemote(path, data, hash || (await sha256Hex(data)))
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) return // deleted again meanwhile
      throw err
    }
  }

  private async push(stats: SyncStats): Promise<void> {
    for (const op of await this.store.pending()) {
      if (op.op === 'put') {
        const data = await this.store.read(op.path)
        await this.pushFile(op.path, data, op.baseHash, stats)
      } else {
        await this.pushDelete(op.path, op.baseHash, stats)
      }
    }
  }

  private async pushFile(
    path: string,
    data: Uint8Array,
    baseHash: string,
    stats: SyncStats,
  ): Promise<void> {
    try {
      const meta = await this.api.putFile(path, data, baseHash)
      await this.store.markPushed(path, meta.hash)
      stats.pushed++
      return
    } catch (err) {
      if (!(err instanceof ApiError) || !err.isConflict) throw err
    }

    // The server has something else at this path. Fetch it to find out what.
    let server: { data: Uint8Array; hash: string }
    try {
      server = await this.api.getFile(path)
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        // Deleted there while edited here: an edit beats a delete.
        const meta = await this.api.putFile(path, data, '')
        await this.store.markPushed(path, meta.hash)
        stats.pushed++
        this.opts.onNotice?.({ kind: 'restored', path })
        return
      }
      throw err
    }

    // A genuine two-writer conflict: keep both versions.
    const copy = conflictPath(path, this.opts.device)
    await this.store.write(copy, data)
    const copyMeta = await this.api.putFile(copy, data, '')
    await this.store.markPushed(copy, copyMeta.hash)
    await this.store.applyRemote(path, server.data, server.hash)
    stats.conflicts++
    this.opts.onNotice?.({ kind: 'conflict', path, detail: copy })
  }

  private async pushDelete(path: string, baseHash: string, stats: SyncStats): Promise<void> {
    try {
      await this.api.deleteFile(path, baseHash)
      await this.store.forget(path)
      stats.deleted++
      return
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        await this.store.forget(path)
        return
      }
      if (!(err instanceof ApiError) || !err.isConflict) throw err
    }
    // Edited elsewhere while we were deleting it: bring it back.
    await this.download(path)
    stats.conflicts++
    this.opts.onNotice?.({ kind: 'restored', path })
  }
}
