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

/** Thrown when the network is unreachable, as opposed to the server saying no. */
export class OfflineError extends Error {
  constructor(cause?: unknown) {
    super('offline')
    this.name = 'OfflineError'
    this.cause = cause
  }
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

export interface Api {
  login(user: string, password: string, device: string): Promise<void>
  logout(): Promise<void>
  session(): Promise<boolean>
  snapshot(): Promise<Snapshot>
  changes(since: number): Promise<ChangePage>
  getFile(path: string): Promise<{ data: Uint8Array; hash: string }>
  /** baseHash '' means "create; fail if it already exists". */
  putFile(path: string, data: Uint8Array, baseHash: string): Promise<FileMeta>
  deleteFile(path: string, baseHash: string): Promise<void>
  search(q: string): Promise<SearchHit[]>
}

export class HttpApi implements Api {
  constructor(private readonly base: string = '') {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let resp: Response
    try {
      resp = await fetch(this.base + path, { credentials: 'include', ...init })
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
      throw new ApiError(resp.status, code, message, etag?.replace(/^W\//, '').replace(/"/g, ''))
    }
    return resp
  }

  async login(user: string, password: string, device: string): Promise<void> {
    await this.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password, device }),
    })
  }

  async logout(): Promise<void> {
    await this.request('/auth/logout', { method: 'POST' })
  }

  async session(): Promise<boolean> {
    try {
      await this.request('/auth/session')
      return true
    } catch (err) {
      if (err instanceof ApiError && err.isAuth) return false
      throw err
    }
  }

  async snapshot(): Promise<Snapshot> {
    const resp = await this.request('/api/snapshot')
    return resp.json()
  }

  async changes(since: number): Promise<ChangePage> {
    const resp = await this.request(`/api/changes?since=${since}`)
    return resp.json()
  }

  async getFile(path: string): Promise<{ data: Uint8Array; hash: string }> {
    const resp = await this.request(`/api/file?path=${encodeURIComponent(path)}`)
    const hash = (resp.headers.get('ETag') ?? '').replace(/"/g, '')
    const data = new Uint8Array(await resp.arrayBuffer())
    return { data, hash }
  }

  async putFile(path: string, data: Uint8Array, baseHash: string): Promise<FileMeta> {
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' }
    if (baseHash) headers['If-Match'] = `"${baseHash}"`
    else headers['If-None-Match'] = '*'
    const body = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    const resp = await this.request(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers,
      body,
    })
    return resp.json()
  }

  async deleteFile(path: string, baseHash: string): Promise<void> {
    await this.request(`/api/file?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
      headers: { 'If-Match': `"${baseHash}"` },
    })
  }

  async search(q: string): Promise<SearchHit[]> {
    const resp = await this.request(`/api/search?q=${encodeURIComponent(q)}`)
    const body = await resp.json()
    return body.hits ?? []
  }
}
