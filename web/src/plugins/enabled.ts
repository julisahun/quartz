/**
 * Which plugins are turned on, remembered per device.
 *
 * In `localStorage` rather than in the vault, for the same reason the code is
 * not in the vault either: a vault has a membership list, and what runs on my
 * phone is not something another member gets a say in. It is also why the key
 * lives here rather than in `state/persist.ts` — everything that knows plugins
 * exist has to disappear with `src/plugins/`.
 *
 * **Nothing is on until it is turned on.** A plugin that ships is a plugin
 * that is *available*; an app that quietly grows behaviour on update is one
 * nobody chose. So there is no "never asked" state to tell apart from "asked
 * and said no" — both are off, and the absent key means the same as an empty
 * list.
 */
const KEY = 'quartz.plugins'

/**
 * The ids turned on, exactly as stored.
 *
 * Ids of plugins this build has never heard of are kept rather than filtered:
 * a plugin dropped from the build and later restored comes back on, and a
 * device running an older build does not silently uninstall what a newer one
 * turned on. Nothing reads them but `setInstalled`, which writes them back.
 */
export function installedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const ids: unknown = JSON.parse(raw)
    if (!Array.isArray(ids)) return new Set()
    return new Set(ids.filter((id): id is string => typeof id === 'string'))
  } catch {
    // Unparseable, or storage disabled in a private window. Either way this is
    // a preference, and the honest answer to "what is on" is nothing.
    return new Set()
  }
}

export function setInstalled(id: string, on: boolean): void {
  const ids = installedIds()
  if (on) ids.add(id)
  else ids.delete(id)
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    /* The plugin still starts; it just will not be on again next launch. */
  }
}
