import { create } from 'zustand'

/**
 * The app's commands, in one list.
 *
 * A command is something with a name that can be run: what ⌘P offers behind
 * `>`, and what an overflow menu is a hand-picked subset of. Registering them
 * rather than hard-coding each one is what lets a command be added from
 * outside the screen it belongs to — the note actions still live in
 * `ui/actions.ts`, and register from there.
 */
export interface Command {
  /** Stable and unique. Registering an id twice replaces the first. */
  id: string
  title: string
  /** Only offered while this says so — "rename" wants a note open. */
  when?: () => boolean
  run(): void | Promise<void>
}

interface CommandState {
  commands: Command[]
}

const useCommandStore = create<CommandState>()(() => ({ commands: [] }))

/**
 * Adds a command, and hands back the function that takes it away again.
 *
 * Registration order is kept: a list of commands reads best in the order
 * whoever wrote them meant, not alphabetically.
 */
export function addCommand(command: Command): () => void {
  useCommandStore.setState((s) => ({
    commands: [...s.commands.filter((c) => c.id !== command.id), command],
  }))
  return () => {
    useCommandStore.setState((s) => ({ commands: s.commands.filter((c) => c !== command) }))
  }
}

/** React: every registered command, runnable or not. A stable reference. */
export function useCommands(): Command[] {
  return useCommandStore((s) => s.commands)
}

/** Every registered command, outside React. */
export function allCommands(): Command[] {
  return useCommandStore.getState().commands
}

/**
 * The commands runnable right now, narrowed by a query.
 *
 * A `when` that throws counts as a no: a command that cannot say whether it
 * applies is not one to offer, and it must not take the switcher down with it.
 */
export function findCommands(commands: Command[], query: string): Command[] {
  const needle = query.trim().toLowerCase()
  return commands.filter((command) => {
    try {
      if (command.when && !command.when()) return false
    } catch {
      return false
    }
    return needle === '' || command.title.toLowerCase().includes(needle)
  })
}
