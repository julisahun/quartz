import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'

/**
 * The languages a fenced code block can be highlighted in.
 *
 * Chosen by hand rather than taken from `@codemirror/language-data`, which
 * knows a hundred of them. The service worker precaches every chunk in the
 * build — that is what makes the app work offline — so "fetch a language only
 * when a note needs it" would turn into "download all hundred on install", on
 * a phone. Ten of them, loaded on demand and precached in the background, is
 * the trade that keeps both halves.
 *
 * HTML, CSS and JavaScript are the exception: `lang-markdown` already depends
 * on them to parse the HTML a markdown file may contain, so they are in the
 * bundle whatever this file does, and pretending to load them later only
 * splits them into a chunk nothing saves.
 *
 * A fence in a language that is not here is still perfectly legible. It is
 * just not coloured.
 */
export const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: 'javascript',
    alias: ['js', 'jsx', 'mjs', 'cjs', 'node'],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'typescript',
    alias: ['ts', 'tsx'],
    support: javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: 'json',
    alias: ['jsonc'],
    load: () => import('@codemirror/lang-json').then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: 'python',
    alias: ['py'],
    load: () => import('@codemirror/lang-python').then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: 'go',
    alias: ['golang'],
    load: () => import('@codemirror/lang-go').then((m) => m.go()),
  }),
  LanguageDescription.of({
    name: 'sql',
    load: () => import('@codemirror/lang-sql').then((m) => m.sql()),
  }),
  LanguageDescription.of({
    name: 'yaml',
    alias: ['yml'],
    load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  }),
  LanguageDescription.of({ name: 'html', alias: ['htm'], support: html() }),
  LanguageDescription.of({ name: 'css', support: css() }),
  LanguageDescription.of({
    // The one a self-hosted vault is actually full of.
    name: 'shell',
    alias: ['sh', 'bash', 'zsh', 'console', 'shell-session'],
    load: () =>
      import('@codemirror/legacy-modes/mode/shell').then(
        (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
      ),
  }),
]
