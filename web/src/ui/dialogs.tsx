import { useEffect, useRef, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { Close } from './icons'

/**
 * Sheets in place of `prompt()` and `confirm()`.
 *
 * The browser dialogs are unstyleable, ignore the safe area, and are a foreign
 * body inside a standalone PWA or the Tauri shell. These take the same shape at
 * the call site — a promise with a cancel value — so asking a question stays a
 * one-liner.
 */

export interface MenuItem {
  label: string
  hint?: string
  danger?: boolean
  run: () => void
}

interface TextRequest {
  kind: 'text'
  title: string
  label: string
  value: string
  confirmLabel: string
  resolve: (value: string | null) => void
}

interface ConfirmRequest {
  kind: 'confirm'
  title: string
  body?: string
  confirmLabel: string
  danger: boolean
  resolve: (ok: boolean) => void
}

interface MenuRequest {
  kind: 'menu'
  title: string
  items: MenuItem[]
  resolve: (chosen: MenuItem | null) => void
}

interface PasswordRequest {
  kind: 'password'
  title: string
  /** Resolves with a message to show in the sheet, or null when it worked. */
  submit: (input: { current: string; next: string; signOutOthers: boolean }) => Promise<string | null>
  resolve: (changed: boolean) => void
}

type Request = TextRequest | ConfirmRequest | MenuRequest | PasswordRequest

/** The kinds whose cancel value is `false` rather than `null`. */
function dismissValue(request: Request): false | null {
  return request.kind === 'confirm' || request.kind === 'password' ? false : null
}

interface DialogState {
  request: Request | undefined
  show(request: Request): void
  settle(request: Request, outcome: unknown): void
}

const useDialogs = create<DialogState>()((set, get) => ({
  request: undefined,
  show(request) {
    // Two questions at once should not be possible, but if one slips through,
    // the older one is cancelled rather than left hanging on a promise.
    const open = get().request
    if (open) cancel(open)
    set({ request })
  },
  settle(request, outcome) {
    if (get().request !== request) return
    set({ request: undefined })
    ;(request.resolve as (value: unknown) => void)(outcome)
  },
}))

function cancel(request: Request) {
  ;(request.resolve as (value: unknown) => void)(dismissValue(request))
}

/** Asks for a line of text. Resolves to null when dismissed. */
export function askText(options: {
  title: string
  label: string
  value?: string
  confirmLabel?: string
}): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.getState().show({
      kind: 'text',
      title: options.title,
      label: options.label,
      value: options.value ?? '',
      confirmLabel: options.confirmLabel ?? 'Save',
      resolve,
    })
  })
}

/** Asks a yes/no question. Dismissing is a no. */
export function askConfirm(options: {
  title: string
  body?: string
  confirmLabel?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.getState().show({
      kind: 'confirm',
      title: options.title,
      body: options.body,
      confirmLabel: options.confirmLabel ?? 'OK',
      danger: options.danger ?? false,
      resolve,
    })
  })
}

/**
 * Asks for a password change. Unlike the others this sheet does the work
 * itself: the server can refuse — a wrong current password, one too short —
 * and reopening a fresh sheet would throw away everything already typed.
 */
export function askPassword(options: {
  title: string
  submit: PasswordRequest['submit']
}): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.getState().show({ kind: 'password', title: options.title, submit: options.submit, resolve })
  })
}

/** The overflow menu behind a `⋯` button. */
export function openMenu(title: string, items: MenuItem[]): Promise<MenuItem | null> {
  return new Promise((resolve) => {
    useDialogs.getState().show({ kind: 'menu', title, items, resolve })
  })
}

export function Dialogs() {
  const request = useDialogs((s) => s.request)
  const settle = useDialogs((s) => s.settle)
  const sheet = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<Element | null>(null)

  useEffect(() => {
    if (!request) return
    returnFocus.current = document.activeElement
    // The field if there is one, otherwise the sheet itself: landing on the
    // close button would put a focus ring on "dismiss" as the sheet opens.
    const field = sheet.current?.querySelector<HTMLElement>('input')
    ;(field ?? sheet.current)?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(request, dismissValue(request))
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const previous = returnFocus.current
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [request, settle])

  if (!request) return null
  const dismiss = () => settle(request, dismissValue(request))

  return (
    <div className="sheet-layer">
      <div className="sheet-scrim" onClick={dismiss} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        ref={sheet}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <header className="sheet-head">
          <h2 id="sheet-title">{request.title}</h2>
          <button className="icon-button" onClick={dismiss} aria-label="Close">
            <Close />
          </button>
        </header>
        {request.kind === 'text' && <TextBody request={request} onSettle={settle} />}
        {request.kind === 'confirm' && <ConfirmBody request={request} onSettle={settle} />}
        {request.kind === 'menu' && <MenuBody request={request} onSettle={settle} />}
        {request.kind === 'password' && <PasswordBody request={request} onSettle={settle} />}
      </div>
    </div>
  )
}

type Settle = DialogState['settle']

function TextBody({ request, onSettle }: { request: TextRequest; onSettle: Settle }) {
  const [value, setValue] = useState(request.value)

  return (
    <form
      className="sheet-body"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = value.trim()
        if (trimmed) onSettle(request, trimmed)
      }}
    >
      <label className="field">
        <span>{request.label}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="done"
        />
      </label>
      <div className="sheet-actions">
        <button type="button" className="button" onClick={() => onSettle(request, null)}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={value.trim() === ''}>
          {request.confirmLabel}
        </button>
      </div>
    </form>
  )
}

function ConfirmBody({ request, onSettle }: { request: ConfirmRequest; onSettle: Settle }) {
  return (
    <div className="sheet-body">
      {request.body && <p className="muted">{request.body}</p>}
      <div className="sheet-actions">
        <button type="button" className="button" onClick={() => onSettle(request, false)}>
          Cancel
        </button>
        <button
          type="button"
          className={`button ${request.danger ? 'danger' : 'primary'}`}
          onClick={() => onSettle(request, true)}
        >
          {request.confirmLabel}
        </button>
      </div>
    </div>
  )
}

function MenuBody({ request, onSettle }: { request: MenuRequest; onSettle: Settle }) {
  return (
    <div className="sheet-body menu">
      {request.items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`menu-item ${item.danger ? 'danger' : ''}`}
          onClick={() => {
            onSettle(request, item)
            item.run()
          }}
        >
          <span>{item.label}</span>
          {item.hint && <span className="menu-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}

function PasswordBody({ request, onSettle }: { request: PasswordRequest; onSettle: Settle }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    // The two client-side rules exist to save a round trip, not to be the
    // check: the server holds the same minimum and is the one that counts.
    if (next.length < 8) return setError('Use at least 8 characters.')
    if (next !== again) return setError('Those two do not match.')
    setBusy(true)
    setError(null)
    const failure = await request.submit({ current, next, signOutOthers })
    setBusy(false)
    if (failure === null) onSettle(request, true)
    else setError(failure)
  }

  return (
    <form className="sheet-body" onSubmit={submit}>
      <label className="field">
        <span>Current password</span>
        <input
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          enterKeyHint="next"
        />
      </label>
      <label className="field">
        <span>New password</span>
        <input
          type="password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          autoComplete="new-password"
          enterKeyHint="next"
        />
      </label>
      <label className="field">
        <span>New password again</span>
        <input
          type="password"
          value={again}
          onChange={(event) => setAgain(event.target.value)}
          autoComplete="new-password"
          enterKeyHint="done"
        />
      </label>
      <label className="field-check">
        <input
          type="checkbox"
          checked={signOutOthers}
          onChange={(event) => setSignOutOthers(event.target.checked)}
        />
        <span>Sign out my other devices</span>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="button" onClick={() => onSettle(request, false)}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={busy || current === '' || next === ''}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  )
}
