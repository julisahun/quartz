import { afterEach, describe, expect, it } from 'vitest'
import { addCommand, allCommands, findCommands, type Command } from './commands'

const undo: Array<() => void> = []

function add(command: Command): Command {
  undo.push(addCommand(command))
  return command
}

const noop = () => {}

afterEach(() => {
  for (const remove of undo.splice(0).reverse()) remove()
})

describe('the command registry', () => {
  it('keeps registration order', () => {
    add({ id: 'b', title: 'Beta', run: noop })
    add({ id: 'a', title: 'Alpha', run: noop })
    expect(allCommands().map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('replaces a command registered under the same id', () => {
    add({ id: 'x', title: 'First', run: noop })
    add({ id: 'x', title: 'Second', run: noop })
    expect(allCommands().filter((c) => c.id === 'x').map((c) => c.title)).toEqual(['Second'])
  })

  it('removes only what the disposer was given', () => {
    const removeFirst = addCommand({ id: 'one', title: 'One', run: noop })
    add({ id: 'two', title: 'Two', run: noop })
    removeFirst()
    expect(allCommands().map((c) => c.id)).toEqual(['two'])
  })

  /**
   * Re-registering then disposing the *old* handle must not take the new
   * command with it: a plugin restarted in place would otherwise leave the
   * registry empty and nothing would say why.
   */
  it('does not let a stale disposer remove its replacement', () => {
    const removeOld = addCommand({ id: 'x', title: 'Old', run: noop })
    add({ id: 'x', title: 'New', run: noop })
    removeOld()
    expect(allCommands().map((c) => c.title)).toEqual(['New'])
  })
})

describe('finding commands', () => {
  it('matches on the title, case-insensitively', () => {
    add({ id: 'a', title: 'Open today’s note', run: noop })
    add({ id: 'b', title: 'Sync now', run: noop })
    expect(findCommands(allCommands(), 'SYNC').map((c) => c.id)).toEqual(['b'])
  })

  it('offers everything runnable when nothing is typed', () => {
    add({ id: 'a', title: 'One', run: noop })
    add({ id: 'b', title: 'Two', run: noop })
    expect(findCommands(allCommands(), '  ')).toHaveLength(2)
  })

  it('hides a command whose `when` says no', () => {
    add({ id: 'a', title: 'Rename', when: () => false, run: noop })
    add({ id: 'b', title: 'Sync', when: () => true, run: noop })
    expect(findCommands(allCommands(), '').map((c) => c.id)).toEqual(['b'])
  })

  // A command that cannot decide whether it applies is not one to offer, and
  // must not take the whole switcher down on the way.
  it('hides a command whose `when` throws', () => {
    add({
      id: 'bad',
      title: 'Bad',
      when: () => {
        throw new Error('nope')
      },
      run: noop,
    })
    add({ id: 'good', title: 'Good', run: noop })
    expect(findCommands(allCommands(), '').map((c) => c.id)).toEqual(['good'])
  })
})
