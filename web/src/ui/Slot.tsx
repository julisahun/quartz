import { Component, useMemo, type ErrorInfo, type ReactNode } from 'react'
import { create } from 'zustand'
import { useApp } from '../state/store'

/**
 * Named places in the chrome that anything can render into.
 *
 * A screen names a slot and renders whatever is in it; it does not know who
 * put it there or why. Three places are worth opening up — a section in the
 * sidebar, an item in the status bar, a panel under the editor — and each one
 * costs its screen a single line.
 */
export type SlotName = 'sidebar.sections' | 'status.items' | 'note.panels'

export interface SlotContext {
  /** The open note, or undefined when nothing is. */
  path: string | undefined
}

export interface SlotEntry {
  /** Stable and unique within the slot. Registering an id twice replaces it. */
  id: string
  /** Ascending. Ties keep registration order. Defaults to 0. */
  order?: number
  render: (context: SlotContext) => ReactNode
}

interface SlotState {
  slots: Record<SlotName, SlotEntry[]>
}

const empty = (): SlotState['slots'] => ({
  'sidebar.sections': [],
  'status.items': [],
  'note.panels': [],
})

const useSlotStore = create<SlotState>()(() => ({ slots: empty() }))

/** Puts something in a slot, and hands back the function that removes it. */
export function addToSlot(name: SlotName, entry: SlotEntry): () => void {
  useSlotStore.setState((s) => ({
    slots: { ...s.slots, [name]: sorted([...s.slots[name].filter((e) => e.id !== entry.id), entry]) },
  }))
  return () => {
    useSlotStore.setState((s) => ({
      slots: { ...s.slots, [name]: s.slots[name].filter((e) => e !== entry) },
    }))
  }
}

/** Empties every slot. Tests use it; nothing in the app does. */
export function clearSlots(): void {
  useSlotStore.setState({ slots: empty() })
}

/** Stable sort, so `order` decides and registration order breaks the ties. */
function sorted(entries: SlotEntry[]): SlotEntry[] {
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => (a.entry.order ?? 0) - (b.entry.order ?? 0) || a.i - b.i)
    .map(({ entry }) => entry)
}

export function Slot({ name }: { name: SlotName }) {
  const entries = useSlotStore((s) => s.slots[name])
  const path = useApp((s) => s.currentPath)
  const context = useMemo(() => ({ path }), [path])

  if (entries.length === 0) return null
  return (
    <>
      {entries.map((entry) => (
        <Contained key={entry.id} id={entry.id} slot={name}>
          <Rendered entry={entry} context={context} />
        </Contained>
      ))}
    </>
  )
}

/**
 * An entry's own component.
 *
 * Not `entry.render(context)` inlined above, for two reasons that both bite:
 * hooks called in there would join *this* component's hook list and come apart
 * the moment a slot gains or loses an entry, and a throw would happen in the
 * boundary's own render, which is the one place a boundary cannot catch.
 */
function Rendered({ entry, context }: { entry: SlotEntry; context: SlotContext }) {
  return <>{entry.render(context)}</>
}

/**
 * One entry's blast radius.
 *
 * Whatever ends up in a slot was not written by the screen showing it, so a
 * throw from one entry takes out that entry and nothing else. Without this a
 * single bad render is a white screen, and the notes behind it look lost.
 */
class Contained extends Component<
  { id: string; slot: SlotName; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.slot}/${this.props.id} failed to render`, error, info)
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
