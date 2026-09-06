import 'fake-indexeddb/auto'

// jsdom has no layout, and so no scrollIntoView. Anything that keeps a
// highlighted row on screen calls it; nothing in a test can observe it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
