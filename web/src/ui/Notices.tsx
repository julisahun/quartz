import { useEffect, useState } from 'react'
import { useApp, type Notice } from '../state/store'
import { Close } from './icons'

/** How long a passing notice stays, and one carrying an Undo. */
const PASSING_MS = 6_000
const WITH_ACTION_MS = 10_000

/**
 * Something happened that is worth saying but needs nothing done —
 * "renamed", "moved", "deleted (Undo)" — goes away by itself. A conflict copy
 * or an error stays until dismissed: a conflict copy that goes unnoticed is a
 * note you think you lost.
 */
function lifetime(notice: Notice): number | undefined {
  if (notice.kind === 'conflict' || notice.kind === 'error') return undefined
  return notice.action ? WITH_ACTION_MS : PASSING_MS
}

export function Notices() {
  const notices = useApp((s) => s.notices)
  if (notices.length === 0) return <div className="notices" role="status" aria-live="polite" />

  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} />
      ))}
    </div>
  )
}

function NoticeCard({ notice }: { notice: Notice }) {
  const dismiss = useApp((s) => s.dismissNotice)
  // Paused while pointed at or focused, so an Undo being reached for does not
  // vanish from under the pointer.
  const [held, setHeld] = useState(false)
  const life = lifetime(notice)

  useEffect(() => {
    if (life === undefined || held) return
    const timer = setTimeout(() => dismiss(notice.id), life)
    return () => clearTimeout(timer)
  }, [life, held, dismiss, notice.id])

  return (
    <div
      className={`notice ${notice.kind}`}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="notice-text">{notice.text}</span>
      {notice.action && (
        <button
          className="notice-action"
          onClick={() => {
            dismiss(notice.id)
            void notice.action!.run()
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button className="ghost" onClick={() => dismiss(notice.id)} aria-label="Dismiss" title="Dismiss">
        <Close />
      </button>
    </div>
  )
}
