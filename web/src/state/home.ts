import { create } from 'zustand'

/**
 * The note a vault opens on, and whoever may have chosen it.
 *
 * A home is either a path somebody typed, or a *source*: something that works
 * the path out when it is asked — "today's note" is a different file every
 * day, so storing the path it had yesterday would be wrong by morning.
 * Sources are registered from outside, the way commands and slots are; this
 * file does not know or care what registers them.
 *
 * Remembered per device and per vault. Per vault because a path only means
 * something inside the vault it is in; per device, in `localStorage` rather
 * than in the vault, because a vault has members and where my phone opens is
 * not theirs to decide.
 *
 * **The last one set wins.** A source that turns up for the first time takes
 * over — that is what turning one on asks for — but only the first time: a
 * person who then picks a note has the last word, and the source does not
 * take it back on the next launch. Each vault remembers which sources it has
 * already seen to tell the two apart.
 */
export interface HomeSource {
  /** Stable and unique. Registering an id twice replaces the first. */
  id: string
  /** What it is, in Settings: "Today's note". */
  label: string
  /** Who offers it, if anyone is worth naming. */
  by?: string
  /** The path to open. May create the note it names. */
  resolve(): Promise<string | undefined>
}

export type HomeChoice =
  | { kind: 'note'; path: string }
  // The label is kept so Settings can still say what was chosen on a launch
  // where nothing offers that source any more.
  | { kind: 'source'; id: string; label: string }

interface VaultHome {
  choice?: HomeChoice
  /** Source ids this vault has met, so a returning one does not take over. */
  seen: string[]
}

const KEY = 'quartz.home'

interface HomeState {
  sources: HomeSource[]
  /** Bumped on every write, so a screen showing the choice re-reads it. */
  version: number
}

const useHomeStore = create<HomeState>()(() => ({ sources: [], version: 0 }))

/** Offers a home, and hands back the function that withdraws it. */
export function addHomeSource(source: HomeSource): () => void {
  useHomeStore.setState((s) => ({ sources: [...s.sources.filter((x) => x.id !== source.id), source] }))
  return () => {
    useHomeStore.setState((s) => ({ sources: s.sources.filter((x) => x !== source) }))
    forget(source.id)
  }
}

/** React: what is on offer, and a number that moves when a choice does. */
export function useHomeSources(): { sources: HomeSource[]; version: number } {
  const sources = useHomeStore((s) => s.sources)
  const version = useHomeStore((s) => s.version)
  return { sources, version }
}

/**
 * The vault's home, after letting any source it has not met yet take over.
 *
 * Writes when that happens, which is why it is a function and not a getter
 * on stored state: the hand-over is decided lazily, on the first look at a
 * vault after a source arrives, because sources are registered before any
 * vault is open.
 */
export function homeOf(vault: string): HomeChoice | undefined {
  const all = readAll()
  const home = all[vault] ?? { seen: [] }
  const fresh = useHomeStore.getState().sources.filter((source) => !home.seen.includes(source.id))
  if (fresh.length === 0) return home.choice

  const newest = fresh[fresh.length - 1]
  all[vault] = {
    choice: { kind: 'source', id: newest.id, label: newest.label },
    seen: [...home.seen, ...fresh.map((source) => source.id)],
  }
  writeAll(all)
  return all[vault].choice
}

/** Sets a vault's home, or clears it with `undefined`. */
export function setHome(vault: string, choice: HomeChoice | undefined): void {
  // Settled first, so a source arriving later than this choice still counts
  // as met and does not overrule it on the next look.
  homeOf(vault)
  const all = readAll()
  all[vault] = { seen: all[vault]?.seen ?? [], choice }
  writeAll(all)
}

/**
 * Where a choice points right now: a path, or why there is none.
 *
 * A source that throws is reported rather than allowed to stop a vault from
 * opening — whatever it was, the notes are still there.
 */
export async function resolveHome(
  choice: HomeChoice,
): Promise<{ path: string } | { problem: string }> {
  if (choice.kind === 'note') return { path: choice.path }
  const source = useHomeStore.getState().sources.find((s) => s.id === choice.id)
  if (!source) return { problem: `${choice.label} is not available here` }
  try {
    const path = await source.resolve()
    return path ? { path } : { problem: `${choice.label} has nothing to open` }
  } catch (err) {
    return { problem: `${choice.label} failed: ${String(err)}` }
  }
}

/** A source withdrawn for good: no vault keeps it as home, or as met. */
function forget(id: string): void {
  const all = readAll()
  for (const home of Object.values(all)) {
    home.seen = home.seen.filter((seen) => seen !== id)
    if (home.choice?.kind === 'source' && home.choice.id === id) home.choice = undefined
  }
  writeAll(all)
}

function readAll(): Record<string, VaultHome> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, VaultHome>)
      : {}
  } catch {
    // Unparseable, or storage off in a private window: no home, which is
    // what this device had before there were homes at all.
    return {}
  }
}

function writeAll(all: Record<string, VaultHome>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* A preference. Not worth failing over. */
  }
  useHomeStore.setState((s) => ({ version: s.version + 1 }))
}
