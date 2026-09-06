/**
 * What never counts as part of a vault.
 *
 * The third copy of one rule set: the server has it in `internal/vault`, the
 * desktop shell in `src-tauri/src/vault.rs`, and this one is for a folder
 * walked in the browser. A file means the same thing in all three, so any
 * change here belongs in the other two on the same day.
 *
 * Only a folder opened from disk needs it. A synced vault never sees these
 * paths, because the server filtered them before they were ever sent.
 */
export function isIgnored(rel: string): boolean {
  for (const segment of rel.split('/')) {
    if (segment === '.git' || segment === '.trash' || segment.startsWith('.quartz')) return true
  }
  const last = rel.slice(rel.lastIndexOf('/') + 1)
  if (last === '.DS_Store' || last === 'Thumbs.db') return true
  if (rel.startsWith('.obsidian/')) {
    // Obsidian's own settings travel with the vault; its per-device state does
    // not, or two machines would fight over which panes are open.
    return (
      last === 'workspace.json' ||
      last === 'workspace-mobile.json' ||
      last === 'cache' ||
      rel.includes('/cache/')
    )
  }
  return false
}

/**
 * Directories worth not descending into at all. Every path inside one of these
 * is ignored anyway, so walking a big `.git` only wastes time — while
 * `.obsidian` has to be entered, since most of what it holds is kept.
 */
export function isPrunedDir(name: string): boolean {
  return name === '.git' || name === '.trash' || name.startsWith('.quartz')
}
