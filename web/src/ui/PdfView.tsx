import { useEffect, useState } from 'react'
import { humanSize, noteTitle } from '../state/notes'
import { useApp } from '../state/store'
import { Download, External, FileText } from './icons'

/**
 * A PDF, in the pane where a note would be.
 *
 * The vault is full of them — handouts, maps, character sheets — and they sync
 * like everything else, so the bytes are already on the device. They are shown
 * through the browser's own PDF viewer rather than a bundled one: pdf.js would
 * add several hundred kilobytes to what the service worker precaches on every
 * install, which is a lot to carry on a phone to avoid one tap.
 *
 * Where the browser has no viewer — iOS, and WebKitGTK on Linux — `Open`
 * hands the file to one that does. iOS renders a PDF perfectly well as a whole
 * page; it is only a frame inside a page that it refuses to scroll.
 */
export function PdfView({ path }: { path: string }) {
  const blobUrl = useApp((s) => s.blobUrl)
  const files = useApp((s) => s.files)
  const [url, setUrl] = useState<string | undefined>()
  const [failed, setFailed] = useState(false)

  const name = noteTitle(path)
  const size = files.find((f) => f.path === path)?.size

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

    // The URL holds the whole file in memory until it is let go of.
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, blobUrl])

  return (
    <div className="pdf">
      <header className="pdf-head">
        <span className="pdf-icon" aria-hidden="true">
          <FileText />
        </span>
        <span className="pdf-name" title={path}>
          {name}
        </span>
        {size !== undefined && <span className="pdf-size">{humanSize(size)}</span>}
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

      {failed ? (
        <p className="empty">{path} is not stored on this device yet.</p>
      ) : !url ? (
        <p className="empty">Opening…</p>
      ) : inlineViewer() ? (
        <iframe className="pdf-frame" src={url} title={name} />
      ) : (
        <div className="pdf-out">
          <p className="muted">This browser will not scroll a PDF inside a page.</p>
          <button className="button primary" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
            Open {name}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Whether an inline frame will actually show the document.
 *
 * `pdfViewerEnabled` is the browser saying so itself, and iOS says no. Older
 * engines that never learned the property are assumed to have a viewer, since
 * every desktop one did.
 */
function inlineViewer(): boolean {
  const supported = navigator.pdfViewerEnabled
  if (typeof supported === 'boolean') return supported
  return !/iP(hone|od|ad)/.test(navigator.userAgent)
}
