import type { VaultStore } from '../vault/types'

/**
 * A stable, human-readable name for this device. It ends up inside conflict
 * file names, so "iphone" is worth having over a random id — but a suffix
 * keeps two browsers on the same machine apart.
 */
export async function deviceName(store: VaultStore): Promise<string> {
  const existing = await store.flag('device')
  if (existing) return existing

  const ua = navigator.userAgent
  let kind = 'browser'
  if (/iPhone/i.test(ua)) kind = 'iphone'
  else if (/iPad/i.test(ua)) kind = 'ipad'
  else if (/Android/i.test(ua)) kind = 'android'
  else if (/Macintosh/i.test(ua)) kind = 'mac'
  else if (/Windows/i.test(ua)) kind = 'windows'
  else if (/Linux/i.test(ua)) kind = 'linux'

  const suffix = Math.random().toString(16).slice(2, 6)
  const name = `${kind}-${suffix}`
  await store.setFlag('device', name)
  return name
}
