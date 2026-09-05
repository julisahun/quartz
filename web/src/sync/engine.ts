import { ApiError, type Api, type Change } from '../api/client'
import type { VaultStore } from '../vault/types'
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
    private readonly api: Api,
    private readonly opts: SyncOptions,
  ) {}

  async sync(): Promise<SyncStats> {
    const stats = emptyStats()
    if (!(await this.store.flag('bootstrapped'))) {
      await this.reconcile(stats)
    }
    await this.pull(stats)
    await this.push(stats)
    return stats
  }

  /**
   * Reconcile against the full manifest instead of the journal. Used on the
   * first sync, and again if the server's index was rebuilt and its sequence
   * numbers restarted.
   */
  private async reconcile(stats: SyncStats): Promise<void> {
    const snap = await this.api.snapshot()
    for (const remote of snap.files) {
      const local = await this.store.meta(remote.path)
      if (!local || local.deleted) {
        await this.download(remote.path)
        stats.pulled++
        continue
      }
      if (local.hash === remote.hash) {
        await this.store.markPushed(remote.path, remote.hash)
        continue
      }
      // Same path, different bytes, no shared history: keep both.
      const data = await this.store.read(remote.path)
      const copy = conflictPath(remote.path, this.opts.device)
      await this.store.write(copy, data)
      await this.download(remote.path)
      stats.conflicts++
      this.opts.onNotice?.({ kind: 'conflict', path: remote.path, detail: copy })
    }
    await this.store.setCursor(snap.head)
    await this.store.setFlag('epoch', snap.epoch)
    await this.store.setFlag('bootstrapped', '1')
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
      for (const change of page.changes) {
        await this.applyChange(change, stats)
      }
      await this.store.setCursor(page.head)
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
      await this.store.applyRemote(path, data, hash)
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
