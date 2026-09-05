import { useApp } from '../state/store'

/**
 * Sync outcomes the user needs to know about: a conflict copy was made, a note
 * came back, the server rebuilt its index. They stay until dismissed — a
 * conflict copy that goes unnoticed is a note you think you lost.
 */
export function Notices() {
  const notices = useApp((s) => s.notices)
  const dismiss = useApp((s) => s.dismissNotice)
  if (notices.length === 0) return null

  return (
    <div className="notices">
      {notices.map((notice) => (
        <div key={notice.id} className={`notice ${notice.kind}`}>
          <span>{notice.text}</span>
          <button className="ghost" onClick={() => dismiss(notice.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
