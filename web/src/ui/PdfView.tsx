import { noteTitle } from '../state/notes'
import { FileHead, useFileUrl } from './FileView'
import { FileText } from './icons'

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
  const { url, failed } = useFileUrl(path)
  const name = noteTitle(path)

  return (
    <div className="fileview">
      <FileHead path={path} url={url} icon={<FileText />} />

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
