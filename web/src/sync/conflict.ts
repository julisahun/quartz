/**
 * Builds the sidecar name used when a push loses a race:
 * "note (conflict <device> <date>).md". Mirrors vault.ConflictPath on the
 * server so both sides produce the same shape.
 */
export function conflictPath(path: string, device: string, when: Date = new Date()): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const hasExt = dot > slash + 1
  const base = hasExt ? path.slice(0, dot) : path
  const ext = hasExt ? path.slice(dot) : ''
  const safeDevice = device.replace(/[^A-Za-z0-9_-]/g, '-')
  const stamp = when.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '')
  return `${base} (conflict ${safeDevice} ${stamp})${ext}`
}
