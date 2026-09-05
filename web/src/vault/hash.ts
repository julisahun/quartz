/**
 * sha256, hex-encoded — byte-for-byte the same value the server puts in an
 * ETag, so the two sides can compare hashes without trusting timestamps.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
