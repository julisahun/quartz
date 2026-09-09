import { useEffect, useState } from 'react'
import { noteTitle } from '../state/notes'
import { FileHead, useFileUrl } from './FileView'
import { Photo } from './icons'

/**
 * An image, in the pane where a note would be.
 *
 * The same argument as a PDF: the vault holds maps, scans and photographs that
 * sync like everything else, and one that no note happens to embed still has
 * to be openable. Nothing is bundled to show it — an `<img>` over the bytes
 * already on the device, which is why it works offline and on a phone.
 *
 * A tap toggles between fitting the pane and the image's own size. Fitting is
 * the default because it is what makes a photograph look right; a map or a
 * scanned page is illegible shrunk to a pane and is why the other half of the
 * toggle exists, with the surrounding box left to scroll.
 */
export function ImageView({ path }: { path: string }) {
  const { url, failed } = useFileUrl(path)
  const [actualSize, setActualSize] = useState(false)
  const [broken, setBroken] = useState(false)
  const name = noteTitle(path)

  // A different file starts fitted again, and is not broken until it says so.
  useEffect(() => {
    setActualSize(false)
    setBroken(false)
  }, [path])

  return (
    <div className="fileview">
      <FileHead path={path} url={url} icon={<Photo />} />

      {failed ? (
        <p className="empty">{path} is not stored on this device yet.</p>
      ) : !url ? (
        <p className="empty">Opening…</p>
      ) : broken ? (
        // Stored, synced, and still not an image: a truncated download, or a
        // file whose extension is the only thing about it that is a PNG.
        <p className="empty">{path} could not be displayed. The file may be damaged.</p>
      ) : (
        <div className={`image-box ${actualSize ? 'actual' : ''}`}>
          <img
            className="image-full"
            src={url}
            alt={name}
            onError={() => setBroken(true)}
            onClick={() => setActualSize((was) => !was)}
            title={actualSize ? 'Fit to the pane' : 'Show at its own size'}
          />
        </div>
      )}
    </div>
  )
}
