import { useCallback, useEffect, useRef, useState } from 'react'

export type Screen = 'list' | 'note' | 'settings'

export interface Screens {
  /** What is on top. */
  screen: Screen
  showNote(): void
  showSettings(): void
  /** Off whatever is on top, back to what was under it. */
  back(): void
}

/**
 * One screen at a time, with the back gesture and the browser's own back
 * button both meaning the same thing.
 *
 * A stack rather than a flag, which a second screen is what forced: opening
 * settings from a note has to come back to the note, and "am I pushed" cannot
 * answer that. Each screen over the list is a `history` entry, so a swipe from
 * the edge of a standalone PWA does what it does everywhere else on the
 * device, and `popstate` is the only thing that pops — `back()` asks history
 * and lets the listener do the rest, so there is one path off a screen.
 *
 * The note screen only exists on a phone, since above 46rem both panes show at
 * once. Settings covers the app at every width.
 */
export function useScreens(phone: boolean): Screens {
  // The stack lives in a ref and the top of it in state: a push has to decide
  // whether it is a no-op *before* pushing a history entry, and a state
  // updater is not a place to do something the DOM will remember.
  const stack = useRef<Screen[]>(['list'])
  const [screen, setScreen] = useState<Screen>('list')

  const settle = useCallback(() => setScreen(stack.current[stack.current.length - 1] ?? 'list'), [])

  useEffect(() => {
    const onPop = () => {
      if (stack.current.length > 1) stack.current.pop()
      settle()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [settle])

  const push = useCallback(
    (next: Screen) => {
      if (stack.current[stack.current.length - 1] === next) return
      stack.current.push(next)
      history.pushState({ quartz: next }, '')
      settle()
    },
    [settle],
  )

  const showNote = useCallback(() => {
    if (phone) push('note')
  }, [phone, push])

  const showSettings = useCallback(() => push('settings'), [push])

  const back = useCallback(() => {
    // Nothing to go back to. Not `history.back()` either: leaving the app is
    // not what the back button in a header means.
    if (stack.current.length > 1) history.back()
  }, [])

  // Growing past the phone breakpoint shows both panes at once, so the note
  // screen stops meaning anything and drops out from under whatever is over
  // it. Settings still means something and stays. The history entry the note
  // was pushed with is harmless, and waits until something pops it.
  useEffect(() => {
    if (phone || !stack.current.includes('note')) return
    stack.current = stack.current.filter((entry) => entry !== 'note')
    settle()
  }, [phone, settle])

  return { screen, showNote, showSettings, back }
}
