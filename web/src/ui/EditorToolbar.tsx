import type { EditorView } from '@codemirror/view'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  cycleHeading,
  indentLess,
  indentMore,
  insertAttachments,
  insertLink,
  insertWikilink,
  toggleBullet,
  toggleQuote,
  toggleTask,
  toggleWrap,
  undo,
} from '../editor/commands'
import { setAccessoryHeight } from '../editor/mobile'
import { useApp } from '../state/store'
import { BulletList, ChevronDown, Code, Indent, Link, Outdent, Paperclip, Quote, TaskList, Undo } from './icons'
import { useKeyboardOpen } from './media'

/**
 * The strip above the on-screen keyboard.
 *
 * Markdown is punctuation, and a phone keyboard hides punctuation two layers
 * down. Everything here is something that would otherwise cost a trip to the
 * symbol layout, or a shortcut that has no key to press.
 */
export function EditorToolbar({ view }: { view: EditorView | null }) {
  const keyboardOpen = useKeyboardOpen()
  const [focused, setFocused] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!view) {
      setFocused(false)
      return
    }
    const dom = view.contentDOM
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    setFocused(view.hasFocus)
    dom.addEventListener('focus', on)
    dom.addEventListener('blur', off)
    return () => {
      dom.removeEventListener('focus', on)
      dom.removeEventListener('blur', off)
    }
  }, [view])

  // Shown while the editor holds focus. Buttons refuse focus themselves, so
  // pressing one neither hides the strip nor drops the keyboard.
  const shown = view !== null && (focused || keyboardOpen)

  useEffect(() => {
    setAccessoryHeight(shown ? (bar.current?.offsetHeight ?? 0) : 0)
    return () => setAccessoryHeight(0)
  }, [shown])

  if (!shown || !view) return null

  const run = (command: (target: EditorView) => boolean) => () => {
    command(view)
    view.focus()
  }

  return (
    <div className="toolbar" ref={bar} role="toolbar" aria-label="Formatting">
      <div className="toolbar-scroll">
        <Tool label="Undo" onRun={run(undo)}>
          <Undo />
        </Tool>
        <Tool label="Bold" onRun={run((v) => toggleWrap(v, '**'))}>
          <b>B</b>
        </Tool>
        <Tool label="Italic" onRun={run((v) => toggleWrap(v, '*'))}>
          <i>I</i>
        </Tool>
        <Tool label="Heading" onRun={run(cycleHeading)}>
          <span className="tool-text">H</span>
        </Tool>
        <Tool label="Bullet list" onRun={run(toggleBullet)}>
          <BulletList />
        </Tool>
        <Tool label="Task" onRun={run(toggleTask)}>
          <TaskList />
        </Tool>
        <Tool label="Quote" onRun={run(toggleQuote)}>
          <Quote />
        </Tool>
        <Tool label="Code" onRun={run((v) => toggleWrap(v, '`'))}>
          <Code />
        </Tool>
        <Tool label="Link" onRun={run(insertLink)}>
          <Link />
        </Tool>
        <Tool label="Link to a note" onRun={run(insertWikilink)}>
          <span className="tool-mono">[[]]</span>
        </Tool>
        <Tool label="Outdent" onRun={run(indentLess)}>
          <Outdent />
        </Tool>
        <Tool label="Indent" onRun={run(indentMore)}>
          <Indent />
        </Tool>
        <Tool label="Attach a file" onRun={() => picker.current?.click()}>
          <Paperclip />
        </Tool>
      </div>
      {/* Unrestricted on purpose: iOS then offers the camera, the photo
          library and Files in one sheet, rather than only images. */}
      <input
        ref={picker}
        className="visually-hidden"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (files.length === 0) return
          void insertAttachments(view, files, (file) => useApp.getState().attach(file)).then(() => view.focus())
        }}
      />
      <Tool label="Hide the keyboard" className="toolbar-done" onRun={() => view.contentDOM.blur()}>
        <ChevronDown />
      </Tool>
    </div>
  )
}

function Tool({
  label,
  className = '',
  onRun,
  children,
}: {
  label: string
  className?: string
  onRun: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tool ${className}`}
      title={label}
      aria-label={label}
      // Keeping the default off pointerdown is what stops the editor losing
      // focus — and the keyboard collapsing — the moment a button is touched.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  )
}
