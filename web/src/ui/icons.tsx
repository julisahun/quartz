import type { ReactNode } from 'react'

/**
 * The icon set, small enough to keep inline. Every glyph is a 16px stroke on
 * currentColor, so they take the theme and the disabled state for free.
 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export const ChevronLeft = () => (
  <Svg>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </Svg>
)

export const FolderPlus = () => (
  <Svg>
    <path d="M1.75 12.5v-9h4l1.5 2h7v7a1 1 0 0 1-1 1h-10.5a1 1 0 0 1-1-1Z" />
    <path d="M8 7.5v4M6 9.5h4" />
  </Svg>
)

export const ChevronRight = () => (
  <Svg>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </Svg>
)

export const ChevronDown = () => (
  <Svg>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </Svg>
)

export const Ellipsis = () => (
  <Svg>
    <circle cx="3.4" cy="8" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12.6" cy="8" r="1.05" fill="currentColor" stroke="none" />
  </Svg>
)

export const Plus = () => (
  <Svg>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)

export const Close = () => (
  <Svg>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)

export const Trash = () => (
  <Svg>
    <path d="M2.8 4.3h10.4M6.4 4.3V2.8h3.2v1.5" />
    <path d="M4.2 4.3l.6 8.1a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.1" />
  </Svg>
)

export const Undo = () => (
  <Svg>
    <path d="M3 6.2h6.6a3.2 3.2 0 0 1 0 6.4H6" />
    <path d="M5.6 3.4 2.8 6.2l2.8 2.8" />
  </Svg>
)

export const BulletList = () => (
  <Svg>
    <circle cx="3.2" cy="4.4" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="3.2" cy="11.6" r="1" fill="currentColor" stroke="none" />
    <path d="M6.4 4.4h6.8M6.4 8h6.8M6.4 11.6h6.8" />
  </Svg>
)

export const TaskList = () => (
  <Svg>
    <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="2.4" />
    <path d="M5.4 8.2 7.2 10l3.5-3.7" />
  </Svg>
)

export const Quote = () => (
  <Svg>
    <path d="M3 3.4v9.2" />
    <path d="M6.2 5.2h7M6.2 8h7M6.2 10.8h4.4" />
  </Svg>
)

export const Link = () => (
  <Svg>
    <path d="M6.4 9.6 9.6 6.4" />
    <path d="M7.2 4.5 8.5 3.2a2.7 2.7 0 0 1 3.8 3.8l-1.3 1.3" />
    <path d="M8.8 11.5 7.5 12.8a2.7 2.7 0 0 1-3.8-3.8l1.3-1.3" />
  </Svg>
)

export const Paperclip = () => (
  <Svg>
    <path d="M9.9 5 5.3 9.6a.95.95 0 0 0 1.35 1.35l4.6-4.6a1.9 1.9 0 0 0-2.7-2.7l-4.6 4.6a2.85 2.85 0 0 0 4.05 4.05l3.5-3.5" />
  </Svg>
)

export const Indent = () => (
  <Svg>
    <path d="M2.8 3.2h10.4M6.4 6.6h6.8M6.4 9.4h6.8M2.8 12.8h10.4" />
    <path d="m2.8 6.6 1.9 1.4-1.9 1.4z" fill="currentColor" stroke="none" />
  </Svg>
)

export const Outdent = () => (
  <Svg>
    <path d="M2.8 3.2h10.4M6.4 6.6h6.8M6.4 9.4h6.8M2.8 12.8h10.4" />
    <path d="m4.7 6.6-1.9 1.4 1.9 1.4z" fill="currentColor" stroke="none" />
  </Svg>
)

export const Code = () => (
  <Svg>
    <path d="M5.8 4.8 2.6 8l3.2 3.2M10.2 4.8 13.4 8l-3.2 3.2" />
  </Svg>
)

export const FileText = () => (
  <Svg>
    <path d="M9 1.75H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.25L9 1.75Z" />
    <path d="M8.9 1.9v3.3h3.3M5.9 8.4h4.2M5.9 10.9h4.2" />
  </Svg>
)

export const External = () => (
  <Svg>
    <path d="M9.5 2.5H13v3.5M12.8 2.7 7.5 8" />
    <path d="M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3" />
  </Svg>
)

export const Download = () => (
  <Svg>
    <path d="M8 2v8M4.8 7 8 10.2 11.2 7" />
    <path d="M2.8 12.5h10.4" />
  </Svg>
)

export const Gear = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.6l.55 1.62 1.7.32.98-1.4 1.34.98-.5 1.65 1.2 1.24 1.68-.36.35 1.63-1.6.6v1.73l1.6.6-.35 1.63-1.68-.36-1.2 1.24.5 1.65-1.34.98-.98-1.4-1.7.32L8 14.4l-.55-1.62-1.7-.32-.98 1.4-1.34-.98.5-1.65-1.2-1.24-1.68.36L.7 8.32l1.6-.6V5.99l-1.6-.6.35-1.63 1.68.36 1.2-1.24-.5-1.65 1.34-.98.98 1.4 1.7-.32z" />
  </Svg>
)

export const Refresh = () => (
  <Svg>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13.2 2.6v2.9h-2.9" />
  </Svg>
)
