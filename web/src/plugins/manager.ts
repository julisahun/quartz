import { create } from 'zustand'
import type { QuartzPlugin } from '@quartz/plugin-api'
import { installedIds, setInstalled } from './enabled'
import { start } from './host'

/**
 * What is available and what is running, and the two calls that move a plugin
 * between them.
 *
 * A module-level store rather than a React context, because the marketplace is
 * rendered through a slot — the app puts it on screen without knowing what it
 * is, so there is no provider anywhere above it to read from. It is the same
 * shape as `state/commands.ts` and `ui/Slot.tsx`, which are singletons for the
 * same reason: there is one of each per app.
 */
interface MarketState {
  /** Everything this build ships, in registry order. */
  catalogue: QuartzPlugin[]
  /** The ids running right now. An array, so the reference moves on a toggle. */
  running: string[]
}

const useMarket = create<MarketState>()(() => ({ catalogue: [], running: [] }))

/** Teardowns for what is running. Not reactive: nothing renders from it. */
const stops = new Map<string, () => void>()

/**
 * Starts what was turned on last time, and puts the marketplace in the
 * settings screen.
 *
 * The marketplace is registered here rather than by the app for the usual
 * reason: `ui/SettingsView.tsx` renders `settings.sections` and has no idea
 * that plugins are one of the things that might be in it.
 */
export function startPlugins(catalogue: QuartzPlugin[], addSection: () => () => void): () => void {
  // Anything still up belongs to a previous call that was not torn down. The
  // app only starts the layer once, but a test that forgets should get a clean
  // one rather than a set of teardowns nothing holds any more.
  for (const id of [...stops.keys()].reverse()) halt(id)
  useMarket.setState({ catalogue, running: [] })

  const installed = installedIds()
  for (const plugin of catalogue) if (installed.has(plugin.id)) run(plugin)

  const removeSection = addSection()

  return () => {
    removeSection()
    // Backwards, so the set comes apart in the order it was put together.
    for (const id of [...stops.keys()].reverse()) halt(id)
    useMarket.setState({ catalogue: [], running: [] })
  }
}

/** Turns a plugin on, now and next launch. Already on is not an error. */
export function install(id: string): void {
  if (stops.has(id)) return
  const plugin = useMarket.getState().catalogue.find((p) => p.id === id)
  if (!plugin) return
  setInstalled(id, true)
  run(plugin)
}

/**
 * Turns a plugin off, now and next launch.
 *
 * The preference is written whether or not anything was running, so an id left
 * over from a build that had the plugin can still be cleared.
 */
export function uninstall(id: string): void {
  setInstalled(id, false)
  halt(id)
}

/** React: the catalogue. A stable reference between toggles. */
export function useCatalogue(): QuartzPlugin[] {
  return useMarket((s) => s.catalogue)
}

/** React: the ids running. */
export function useRunning(): string[] {
  return useMarket((s) => s.running)
}

function run(plugin: QuartzPlugin): void {
  // `start` catches a plugin that throws on the way up and still returns the
  // teardown for whatever it registered first, so this is always safe to keep.
  stops.set(plugin.id, start(plugin))
  useMarket.setState((s) => ({ running: [...s.running, plugin.id] }))
}

function halt(id: string): void {
  const stop = stops.get(id)
  if (!stop) return
  stops.delete(id)
  useMarket.setState((s) => ({ running: s.running.filter((running) => running !== id) }))
  stop()
}
