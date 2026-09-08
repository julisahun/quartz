import { describe, expect, it } from 'vitest'
import {
  folderOf as contractFolderOf,
  noteTitle as contractNoteTitle,
  tagKey as contractTagKey,
  type Backlink as ContractBacklink,
  type MenuItem as ContractMenuItem,
  type Property as ContractProperty,
  type SearchHit as ContractSearchHit,
  type TagSummary as ContractTagSummary,
} from '@quartz/plugin-api'
import type { SearchHit } from '../api/client'
import type { Property } from '../state/frontmatter'
import type { Backlink } from '../state/links'
import { folderOf, noteTitle } from '../state/notes'
import { tagKey } from '../state/tags'
import type { TagSummary } from '../state/vault-index'
import type { MenuItem } from '../ui/dialogs'

/**
 * That the app still means what the contract says it does.
 *
 * `@quartz/plugin-api` declares its own copies of the five shapes that travel
 * through the API, and its own `noteTitle`, `folderOf` and `tagKey`, so that
 * installing it brings none of the app's internals with it. The price of that
 * is two definitions of each, and this is what stops them drifting: the type
 * checks are compile-time — a divergence makes `true` unassignable to `false`
 * and `npm run typecheck` fails — and the rest is the seven lines of path
 * arithmetic that `NoteRef` is defined in terms of.
 *
 * If one of these fails, the app is right and the contract is stale, or the
 * app has quietly broken a promise. Which one it is depends on the change,
 * and that is the question worth being made to answer.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

describe('the app satisfies the plugin contract', () => {
  it('declares the same shapes', () => {
    const property: Exact<Property, ContractProperty> = true
    const backlink: Exact<Backlink, ContractBacklink> = true
    const tagSummary: Exact<TagSummary, ContractTagSummary> = true
    const searchHit: Exact<SearchHit, ContractSearchHit> = true
    const menuItem: Exact<MenuItem, ContractMenuItem> = true

    expect([property, backlink, tagSummary, searchHit, menuItem]).toEqual([true, true, true, true, true])
  })

  it('agrees on what a title and a folder are', () => {
    // A root note, a nested one, an odd extension, an attachment, no extension.
    for (const path of ['Pi.md', 'notes/Pi setup.md', 'deep/a/b.MD', 'notes/diagram.png', 'Makefile']) {
      expect(contractNoteTitle(path)).toBe(noteTitle(path))
      expect(contractFolderOf(path)).toBe(folderOf(path))
    }
  })

  it('agrees on when two tags are the same tag', () => {
    for (const tag of ['#PNJ', '#pnj', '#pnj/roquena', '#Notes/Días']) {
      expect(contractTagKey(tag)).toBe(tagKey(tag))
    }
  })
})
