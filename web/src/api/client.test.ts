import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../vault/hash'
import { HttpApi, IntegrityError, parseETag } from './client'

const body = new TextEncoder().encode('# a note\n\nwith content\n')

function respondWith(headers: Record<string, string>) {
  vi.stubGlobal('fetch', async () => new Response(body, { status: 200, headers }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('etag parsing', () => {
  it('strips quotes, weak prefixes and empties', () => {
    expect(parseETag('"abc"')).toBe('abc')
    expect(parseETag('W/"abc"')).toBe('abc')
    expect(parseETag('')).toBeUndefined()
    expect(parseETag(null)).toBeUndefined()
    expect(parseETag('""')).toBeUndefined()
  })
})

describe('downloading a file', () => {
  it('derives the hash from the bytes when the proxy drops the ETag', async () => {
    // Cloudflare strips or weakens ETag on compressed responses. A client that
    // trusted an empty one would treat every downloaded note as a brand new
    // local file and try to create it again — 412, and a conflict copy for
    // nothing. This is the regression test for exactly that.
    respondWith({})
    const file = await new HttpApi().vault('juli').getFile('a.md')
    expect(file.hash).toBe(await sha256Hex(body))
    expect(file.data).toEqual(body)
  })

  it('accepts a weak ETag', async () => {
    respondWith({ ETag: `W/"${await sha256Hex(body)}"` })
    const file = await new HttpApi().vault('juli').getFile('a.md')
    expect(file.hash).toBe(await sha256Hex(body))
  })

  it('accepts a matching strong ETag', async () => {
    respondWith({ ETag: `"${await sha256Hex(body)}"` })
    const file = await new HttpApi().vault('juli').getFile('a.md')
    expect(file.hash).toBe(await sha256Hex(body))
  })

  it('refuses a file whose bytes do not match the hash the server claims', async () => {
    respondWith({ ETag: `"${'0'.repeat(64)}"` })
    await expect(new HttpApi().vault('juli').getFile('a.md')).rejects.toBeInstanceOf(IntegrityError)
  })
})

describe('changing a password', () => {
  it('posts the three fields and reports how many sessions ended', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.url = url
      seen.init = init
      return new Response(JSON.stringify({ signedOut: 2 }), { status: 200 })
    })

    const out = await new HttpApi().changePassword({
      current: 'old-one',
      next: 'a-longer-secret',
      signOutOthers: true,
    })

    expect(out.signedOut).toBe(2)
    expect(seen.url).toBe('/auth/password')
    expect(seen.init?.method).toBe('POST')
    expect(JSON.parse(String(seen.init?.body))).toEqual({
      current: 'old-one',
      next: 'a-longer-secret',
      signOutOthers: true,
    })
  })

  it('surfaces the server’s refusal as a coded ApiError', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ code: 'invalid_credentials', error: 'nope' }), { status: 401 }),
    )
    await expect(
      new HttpApi().changePassword({ current: 'wrong', next: 'a-longer-secret', signOutOthers: false }),
    ).rejects.toMatchObject({ code: 'invalid_credentials', isAuth: true })
  })
})
