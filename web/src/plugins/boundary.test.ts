import { describe, expect, it } from 'vitest'

/**
 * The two rules that keep this layer detachable, as tests rather than as
 * comments.
 *
 * `host.ts` claims that `src/plugins/` can be deleted, along with two lines of
 * `main.tsx`, and nothing else in the tree has to change. `api.ts` claims that
 * what a plugin is handed is all it is meant to need. Both were true when they
 * were written and neither was checked — which, for a boundary that only
 * matters on the day someone leans on it, is the wrong way round.
 *
 * They are read off the source text rather than the module graph because the
 * question is what the files say, not what a bundler can be talked into: an
 * import that only a test pulls in still couples the two halves.
 */

/** Where the app is wired to the layer — the two lines in question. */
const ENTRY = 'main.tsx'
const PLUGINS = 'plugins'

/**
 * Vite writes its glob keys relative to the file that asked, so a sibling
 * comes back as `./api.ts` and the rest of the app as `../state/store.ts`.
 * Only the directory part of this is used, so it stands in for wherever in
 * `src/plugins/` the test happens to live.
 */
const HERE = `${PLUGINS}/boundary.test.ts`

/**
 * Every source file under `src/`, as text, keyed by its path from there.
 *
 * Through Vite's glob rather than `node:fs` so this needs no node types:
 * `tsconfig.json` keeps `types` down to `vite/client` and `vitest/globals`,
 * and pulling in `@types/node` for one test would change how `setTimeout`
 * types across a browser app.
 */
const files: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  ).map(([key, text]) => [resolveFrom(HERE, key), text]),
)

/**
 * The packages a plugin folder may name. Its `package.json`, in other words —
 * what an external author has to install to build the same thing outside this
 * repo, and the reason the list is asserted rather than merely observed.
 */
const PACKAGES = ['react', '@quartz/plugin-api']
const PACKAGES_IN_TESTS = [...PACKAGES, 'react-dom/client', 'vitest']

/**
 * App modules a plugin's *tests* may reach into. Nothing that ships may.
 *
 * One entry, and it is the frontmatter parser: `fakeQuartz` deliberately has
 * none of its own, because parsing frontmatter is the app's behaviour rather
 * than the contract's, so a test that asserts what the real parser does has to
 * hand it over. That is a real cost — this is the one import that would have
 * to be solved if the plugins ever left the tree — and it is written down here
 * rather than left to be discovered on that day.
 */
const APP_MODULES_IN_TESTS = ['state/frontmatter']

/**
 * The file with its comments blanked out.
 *
 * Prose here is long enough to contain the word `from` followed by a quote,
 * and `enabled.ts` actually does. Stripping first is cheaper than a parser and
 * the only false positive worth guarding against.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const PATTERNS = [
  // `import x from 'y'`, `export { x } from 'y'`, and a bare `import 'y.css'`.
  /^[ \t]*(?:import|export)\b[^\n]*?['"]([^'"\n]+)['"]/gm,
  // The tail of an import whose names are spread over several lines.
  /^[ \t]*\}[ \t]*from[ \t]*['"]([^'"\n]+)['"]/gm,
  // `import('y')`, which is never at the start of its line.
  /\bimport[ \t]*\([ \t]*['"]([^'"\n]+)['"]/g,
]

/** Every module a file names, in the words the file used. */
function specifiers(path: string): string[] {
  const text = code(files[path] ?? '')
  const out = new Set<string>()
  for (const pattern of PATTERNS) {
    for (const [, specifier] of text.matchAll(pattern)) out.add(specifier)
  }
  return [...out]
}

/**
 * Where a relative specifier lands, as a path from `src/`, or undefined when
 * it names a package. Extensions and a trailing `/index` come off both sides,
 * so `'.'`, `'../api'` and `'../api.ts'` are compared as what they mean.
 */
function target(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  return moduleId(resolveFrom(from, specifier))
}

/** `specifier` resolved against the directory `from` sits in. */
function resolveFrom(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function moduleId(path: string): string {
  return path.replace(/\.tsx?$/, '').replace(/\/index$/, '')
}

/** Whether `path` is `dir` or sits under it. */
function inside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}/`)
}

const isTest = (path: string) => /\.test\.tsx?$/.test(path)

describe('the app does not know that plugins exist', () => {
  it('is imported from nowhere but main.tsx', () => {
    const reaching: string[] = []

    for (const path of Object.keys(files)) {
      if (path === ENTRY || inside(PLUGINS, path)) continue
      for (const specifier of specifiers(path)) {
        const to = target(path, specifier)
        if (to && inside(PLUGINS, to)) reaching.push(`${path} -> ${specifier}`)
      }
    }

    // Anything listed here is a second place to edit when the layer comes out,
    // and one the comment in `host.ts` says does not exist.
    expect(reaching).toEqual([])
  })

  it('still has the one wire, so the rule above is not vacuous', () => {
    // Without this, deleting the wiring would be the best way to pass the test
    // above, and the two lines are the whole of what has to be deleted by hand.
    expect(specifiers(ENTRY).filter((specifier) => specifier.includes(PLUGINS))).toEqual(['./plugins'])
  })
})

describe('a plugin reaches the app only through the API', () => {
  const folders = [
    ...new Set(
      Object.keys(files)
        .map((path) => /^plugins\/([^/]+)\//.exec(path)?.[1])
        .filter((name): name is string => name !== undefined),
    ),
  ].sort()

  it('found the plugins to check', () => {
    // A plugin added without a folder of its own would otherwise go unchecked.
    expect(folders).toEqual(['daily-note', 'properties', 'word-count'])
  })

  it.each(folders)('%s imports only what it is given', (name) => {
    const folder = `${PLUGINS}/${name}`
    const escaping: string[] = []

    for (const path of Object.keys(files)) {
      if (!inside(folder, path)) continue
      const test = isTest(path)
      const packages = test ? PACKAGES_IN_TESTS : PACKAGES
      const reachable = test ? APP_MODULES_IN_TESTS : []

      for (const specifier of specifiers(path)) {
        const to = target(path, specifier)
        // A package: fine if it is one this plugin is allowed to need.
        if (to === undefined) {
          if (!packages.includes(specifier)) escaping.push(`${path} -> ${specifier}`)
          continue
        }
        // A relative path: fine inside the plugin's own folder, and otherwise
        // only if it is on the short list the tests are allowed to reach.
        if (inside(folder, to) || reachable.includes(to)) continue
        escaping.push(`${path} -> ${specifier}`)
      }
    }

    // A plugin holding the app's internals is a plugin that breaks when they
    // move — which is the whole thing the contract package exists to make
    // unnecessary.
    expect(escaping).toEqual([])
  })
})
