import 'fake-indexeddb/auto'

// jsdom has no layout, and so no scrollIntoView. Anything that keeps a
// highlighted row on screen calls it; nothing in a test can observe it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Nor does it implement either half of the object-URL API, which is how every
// file that is not text — an image embed, a PDF — reaches the screen. A
// minimal one, so a test can spy on it and see what was handed over.
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  let issued = 0
  URL.createObjectURL = () => `blob:quartz/${++issued}`
  URL.revokeObjectURL = () => {}
}
