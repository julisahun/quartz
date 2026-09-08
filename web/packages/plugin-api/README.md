# `@quartz/plugin-api`

The contract between Quartz and a plugin: the `Quartz` object a plugin is
handed, the shapes that travel through it, the collapsible `Section` a sidebar
block wears, and `fakeQuartz` — a vault of three notes in a Map, which is what
a plugin is tested against.

```ts
import { Section, type Quartz, type QuartzPlugin } from '@quartz/plugin-api'

export const wordCount: QuartzPlugin = {
  id: 'word-count',
  name: 'Word count',
  description: 'Counts the words in the open note.',
  setup(q: Quartz) {
    q.ui.statusItem({ id: 'count', render: () => <Count q={q} /> })
  },
}
```

A plugin never imports anything else from the app. That is not a convention:
the app's `boundary.test.ts` fails if one does.

## Three things to know

**It is consumed as source.** `exports` points at `src/index.ts`, so there is
no build step and no published artifact yet. It lives in the app repo as a
workspace package on purpose — the API is young and still moves, and while it
moves it should move in one commit that typechecks against every plugin at
once. It gets a version number and a real release the day something outside
this repo depends on it.

**The app proves it satisfies this, not the other way round.** The five data
shapes here — `Property`, `Backlink`, `TagSummary`, `SearchHit`, `MenuItem` —
are declared in `src/api.ts` rather than imported from Quartz, so installing
this brings none of the app's internals with it. The app keeps its own
definitions where they belong, and `src/plugins/contract.test.ts` there fails
to compile if the two ever drift apart.

**The host owns the styling.** `Section` renders `px-section*` class names and
ships no CSS. The app styles them in `src/plugins/plugins.css`, which is what
lets a section take the theme; a package shipping its own would only fight the
app it runs in.

## Testing a plugin

`fakeQuartz` has no store, no database and no server behind it:

```ts
const q = fakeQuartz({ 'notes/Pi.md': '# Pi\n\nsome text\n' })
wordCount.setup(q)
expect(q.statusItems).toEqual(['count'])
```

Frontmatter is the one thing it will not do for you. Parsing it is the app's
behaviour rather than the contract's, so `fakeQuartz` takes a parser and has
none of its own — pass one when a test depends on what it does:

```ts
fakeQuartz(files, { frontmatter: parseFrontmatter })
```
