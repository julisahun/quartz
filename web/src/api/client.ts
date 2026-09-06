import { sha256Hex } from '../vault/hash'
import type { FileMeta } from '../vault/types'

export interface Change {
  seq: number
  path: string
  op: 'put' | 'del'
  hash?: string
  size?: number
  mtime?: number
  ts: number
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly etag?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** The session is gone. Never a reason to drop pending work. */
  get isAuth(): boolean {
    return this.status === 401
  }

  get isConflict(): boolean {
    return this.status === 412
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

/**
 * Thrown when a downloaded file does not match the hash the server claims for
 * it — something between the two altered the bytes. Storing it anyway would
 * mean pushing corrupted content back later, so the download fails instead.
 */
export class IntegrityError extends Error {
  constructor(readonly path: string) {
    super(`${path} arrived altered in transit`)
    this.name = 'IntegrityError'
  }
}

/** Thrown when the network is unreachable, as opposed to the server saying no. */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('offline')
    this.name = 'OfflineError'
    this.cause = cause
  }
}

export interface VaultSummary {
  id: string
  name: string
  kind: 'private' | 'shared'
  owner: string
  role: 'owner' | 'member'
}

export interface Identity {
  user: string
  vaults: VaultSummary[]
}

/** Identifies the server's index. A new epoch means it was rebuilt. */
export interface Snapshot {
  head: number
  epoch: string
  files: FileMeta[]
}

export interface ChangePage {
  head: number
  epoch: string
  changes: Change[]
  more: boolean
}

/**
 * Everything inside one vault. The sync engine is handed one of these and
 * never learns which vault it is working on — that is the whole point: a vault
 * is the unit of sync, whoever it belongs to.
 */
export interface VaultApi {
  snapshot(): Promise<Snapshot>
  changes(since: number): Promise<ChangePage>
  getFile(path: string): Promise<{ data: Uint8Array; hash: string }>
  /** baseHash '' means "create; fail if it already exists". */
  putFile(path: string, data: Uint8Array, baseHash: string): Promise<FileMeta>
  deleteFile(path: string, baseHash: string): Promise<void>
  search(q: string): Promise<SearchHit[]>
}

/** Account-level calls, plus a way to get at one vault. */
export interface Api {
  login(user: string, password: string, device: string, desktop?: boolean): Promise<Identity>
  logout(): Promise<void>
  /** The signed-in identity, or undefined when the session is gone. */
  session(): Promise<Identity | undefined>
  vaults(): Promise<VaultSummary[]>
  /** Promotes a folder: the account gets a vault of its own to fill. */
  createVault(input: { id: string; name: string; bytes: number }): Promise<VaultSummary>
  vault(id: string): VaultApi
}

/** Normalises an ETag: weak prefix and quotes off, empty becomes undefined. */
export function parseETag(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = value.replace(/^W\//, '').replace(/"/g, '').trim()
  return cleaned === '' ? undefined : cleaned
}

export class HttpApi implements Api {
  /**
   * `token` is only used by the desktop shell: its webview is a different
   * origin from the server, so a cookie would be a third-party cookie. In a
   * browser this stays undefined and the HttpOnly cookie does the work.
   */
  constructor(
    private readonly base: string = '',
    private token?: string,
    private readonly onToken?: (token: string) => void,
  ) {}

  setToken(token: string | undefined): void {
    this.token = token
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let resp: Response
    const headers = new Headers(init.headers)
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
    try {
      resp = await fetch(this.base + path, { credentials: 'include', ...init, headers })
    } catch (err) {
      // fetch only rejects for network-level failures, which is exactly the
      // offline case: the queue stays, we retry later.
      throw new OfflineError(err)
    }
    if (!resp.ok) {
      const etag = resp.headers.get('ETag') ?? undefined
      let code = 'error'
      let message = resp.statusText
      try {
        const body = await resp.json()
        code = body.code ?? code
        message = body.error ?? message
      } catch {
        /* not JSON; the status is enough */
      }
      throw new ApiError(resp.status, code, message, parseETag(etag))
    }
    return resp
  }

  async login(user: string, password: string, device: string, desktop = false): Promise<Identity> {
    const resp = await this.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password, device, client: desktop ? 'desktop' : 'web' }),
    })
    const body = await resp.json()
    if (desktop && typeof body.token === 'string') {
      this.token = body.token
      this.onToken?.(body.token)
    }
    return { user: body.user, vaults: body.vaults ?? [] }
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' })
    this.token = undefined
    this.onToken?.('')
  }

  async session(): Promise<Identity | undefined> {
    try {
      const resp = await this.request('/auth/session')
      const body = await resp.json()
      return { user: body.user, vaults: body.vaults ?? [] }
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) return undefined
      throw err
    }
  }

  async vaults(): Promise<VaultSummary[]> {
    const resp = await this.request('/api/vaults')
    return (await resp.json()).vaults ?? []
  }

  async createVault(input: { id: string; name: string; bytes: number }): Promise<VaultSummary> {
    const resp = await this.request('/api/vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return resp.json()
  }

  /** Binds every content call below to one vault. */
  vault(id: string): VaultApi {
    const base = `/api/v/${encodeURIComponent(id)}`
    return {
      snapshot: async () => (await this.request(`${base}/snapshot`)).json(),
      changes: async (since: number) => (await this.request(`${base}/changes?since=${since}`)).json(),
      getFile: async (path: string) => {
        const resp = await this.request(`${base}/file?path=${encodeURIComponent(path)}`)
        const data = new Uint8Array(await resp.arrayBuffer())

        // The hash is derived from the bytes, not read from the header.
        // A proxy in front of the server may weaken the ETag to W/"..." or
        // drop it altogether when it compresses a response — and a client that
        // trusted an empty ETag would treat every file it just downloaded as a
        // brand new local one, and try to create it again on the next push.
        const hash = await sha256Hex(data)
        const claimed = parseETag(resp.headers.get('ETag'))
        if (claimed && /^[0-9a-f]{64}$/.test(claimed) && claimed !== hash) {
          throw new IntegrityError(path)
        }
        return { data, hash }
      },
      putFile: async (path: string, data: Uint8Array, baseHash: string) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
        if (baseHash) headers['If-Match'] = `"${baseHash}"`
        else headers['If-None-Match'] = '*'
        const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        const resp = await this.request(`${base}/file?path=${encodeURIComponent(path)}`, {
          method: 'PUT',
          headers,
          body,
        })
        return resp.json()
      },
      deleteFile: async (path: string, baseHash: string) => {
        await this.request(`${base}/file?path=${encodeURIComponent(path)}`, {
          method: 'DELETE',
          headers: { 'If-Match': `"${baseHash}"` },
        })
      },
      search: async (q: string) => {
        const resp = await this.request(`${base}/search?q=${encodeURIComponent(q)}`)
        return (await resp.json()).hits ?? []
      },
    }
  }

}
