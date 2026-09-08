// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useScreens, type Screens } from './screens'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | undefined
let root: Root | undefined
let live: Screens | undefined

/**
 * Mounts the hook and hands back the latest of what it returned.
 *
 * `phone` is a prop rather than an argument so a test can grow the window
 * past the breakpoint, which is the case that used to lose the note screen.
 */
function mount(phone: boolean) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<Probe phone={phone} />))
  return {
    screens: () => live!,
    resize(next: boolean) {
      act(() => root!.render(<Probe phone={next} />))
    },
  }
}

function Probe({ phone }: { phone: boolean }) {
  live = useScreens(phone)
  return null
}

/**
 * Waits for the screen to become `want`.
 *
 * `history.back()` queues its popstate on a later task than the microtask a
 * bare `await` gets you, and how much later is jsdom's business — so this
 * drains the timer queue until the screen settles rather than guessing a
 * delay. Bounded, because a `back()` with nothing to go back to is a case
 * worth asserting and it fires no popstate at all.
 */
async function settle(want?: string) {
  for (let tries = 0; tries < 20; tries++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
    })
    if (want === undefined || live?.screen === want) return
  }
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  live = undefined
  history.replaceState(null, '')
})

describe('the screen stack on a phone', () => {
  it('starts on the list', () => {
    const app = mount(true)
    expect(app.screens().screen).toBe('list')
  })

  it('pushes the note screen and comes back off it', async () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    expect(app.screens().screen).toBe('note')

    act(() => app.screens().back())
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })

  it('goes to settings from the list', async () => {
    const app = mount(true)
    act(() => app.screens().showSettings())
    expect(app.screens().screen).toBe('settings')

    act(() => app.screens().back())
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })

  /**
   * The case a single "am I pushed" flag could not answer, and the reason this
   * is a stack: the gear is on the status bar, which is on screen while a note
   * is open, so settings has to come back to the note.
   */
  it('comes back to the note when settings was opened from it', async () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    act(() => app.screens().showSettings())
    expect(app.screens().screen).toBe('settings')

    act(() => app.screens().back())
    await settle('note')
    expect(app.screens().screen).toBe('note')

    act(() => app.screens().back())
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })

  it('treats the browser’s own back the same as the button', async () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    // What an edge swipe in a standalone PWA turns into.
    history.back()
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })

  it('does not stack the same screen twice', async () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    act(() => app.screens().showNote())
    act(() => app.screens().back())
    await settle('list')
    // One back, not two: the second showNote pushed no history entry.
    expect(app.screens().screen).toBe('list')
  })

  it('does not leave the app when there is nothing to go back to', async () => {
    const app = mount(true)
    act(() => app.screens().back())
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })
})

describe('the screen stack on a wide window', () => {
  it('has no note screen, since both panes show at once', () => {
    const app = mount(false)
    act(() => app.screens().showNote())
    expect(app.screens().screen).toBe('list')
  })

  it('still has settings, which covers the app at every width', async () => {
    const app = mount(false)
    act(() => app.screens().showSettings())
    expect(app.screens().screen).toBe('settings')

    act(() => app.screens().back())
    await settle('list')
    expect(app.screens().screen).toBe('list')
  })

  it('drops the note screen when the window grows past the breakpoint', () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    app.resize(false)
    expect(app.screens().screen).toBe('list')
  })

  /**
   * Growing the window while settings is open should not dismiss it — the note
   * screen underneath is what stopped meaning anything, not this.
   */
  it('keeps settings open when the window grows', () => {
    const app = mount(true)
    act(() => app.screens().showNote())
    act(() => app.screens().showSettings())
    app.resize(false)
    expect(app.screens().screen).toBe('settings')
  })
})
