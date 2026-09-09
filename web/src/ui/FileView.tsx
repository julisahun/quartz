import { useEffect, useState, type ReactNode } from 'react'
import { humanSize, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { Download, External } from './icons'

/**
 * The bytes of a vault file, as a URL something can be pointed at.
 *
 * Shared by the two views that show a file rather than edit it, because the
 * lifetime is the interesting part: an object URL pins the whole file in
 * memory until it is revoked, so a vault of scans browsed one after another
 * would hold every one of them. It is revoked when the path changes and when
 * the view goes away — including when the read lands after that, which is why
 * the promise checks whether it is still wanted before handing anything back.
 */
export function useFileUrl(path: string): { url?: string; failed: boolean } {
  const blobUrl = useApp((s) => s.blobUrl)
  const [url, setUrl] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    let made: string | undefined
    setUrl(undefined)
    setFailed(false)

    void blobUrl(path).then((created) => {
      if (!live) {
        if (created) URL.revokeObjectURL(created)
        return
      }
      made = created
      if (created) setUrl(created)
      else setFailed(true)
    })

    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, blobUrl])

  return { url, failed }
}

/**
 * The bar above a file in the pane: what it is, how big, and the two ways out
 * of the app with it — open it wherever the system would, or save a copy.
 *
 * A note gets none of this; the editor is its own header. A file that is only
 * being displayed has nowhere else to say its name, and the name matters more
 * here than for a note, since the extension is part of it.
 */
export function FileHead({ path, url, icon }: { path: string; url?: string; icon: ReactNode }) {
  const files = useApp((s) => s.files)
  const name = noteTitle(path)
  const size = files.find((f) => f.path === path)?.size

  return (
    <header className="fileview-head">
      <span className="fileview-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="fileview-name" title={path}>
        {name}
      </span>
      {size !== undefined && <span className="fileview-size">{humanSize(size)}</span>}
      {url && (
        <>
          <button
            className="icon-button"
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            aria-label="Open in a new tab"
            title="Open in a new tab"
          >
            <External />
          </button>
          <a className="icon-button" href={url} download={name} aria-label="Save a copy" title="Save a copy">
            <Download />
          </a>
        </>
      )}
    </header>
  )
}
