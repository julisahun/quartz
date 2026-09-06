import { describe, expect, it } from 'vitest'
import { isIgnored, isPrunedDir } from './ignore'

describe('what is not part of a vault', () => {
  // The same cases the Rust shell asserts, so the two cannot drift apart
  // without one of the suites going red.
  it('drops bookkeeping, junk and per-device state', () => {
    for (const path of [
      '.git/config',
      'notes/.git/HEAD',
      '.trash/old.md',
      '.quartz-sync.json',
      '.obsidian/workspace.json',
      '.obsidian/workspace-mobile.json',
      '.obsidian/plugins/x/cache/data',
      '.DS_Store',
      'notes/.DS_Store',
      'Thumbs.db',
    ]) {
      expect(isIgnored(path), path).toBe(true)
    }
  })

  it('keeps notes, attachments and shared Obsidian settings', () => {
    for (const path of [
      'a.md',
      'notes/Pi setup.md',
      'img/pic.png',
      '.obsidian/app.json',
      '.obsidian/plugins/x/main.js',
      'a .git file.md',
    ]) {
      expect(isIgnored(path), path).toBe(false)
    }
  })

  it('prunes only the directories that are ignored whole', () => {
    expect(isPrunedDir('.git')).toBe(true)
    expect(isPrunedDir('.trash')).toBe(true)
    // Most of .obsidian is kept, so it has to be walked into.
    expect(isPrunedDir('.obsidian')).toBe(false)
    expect(isPrunedDir('notes')).toBe(false)
  })
})
