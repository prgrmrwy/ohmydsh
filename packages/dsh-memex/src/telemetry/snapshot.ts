/**
 * Read-only facts about a library and its cards at query time.
 *
 * These answer the two questions recall telemetry could not: what did the
 * library contain when this search ran, and which version of a card did the
 * caller see. Both are lost the moment a card is written or rewritten, so they
 * are captured alongside the search, never reconstructed later.
 *
 * Everything here is read-only. Git runs with `--no-optional-locks` so it does
 * not even refresh the index stat cache, and every failure degrades to
 * "unknown" rather than surfacing: this is bookkeeping for analysis, and must
 * never be able to fail or slow a search noticeably.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { frontmatter, type LibrarySnapshot } from './record.js'

const GIT_TIMEOUT_MS = 1_000

function git(home: string, args: readonly string[]): string {
  return execFileSync('git', ['--no-optional-locks', '-C', home, ...args], {
    windowsHide: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: GIT_TIMEOUT_MS,
  })
}

/**
 * The library's HEAD commit and whether its worktree is dirty.
 *
 * Only the library's own repository counts: a library directory that merely
 * sits inside some other repository is reported as unknown, since that outer
 * HEAD says nothing about the cards.
 */
export function librarySnapshot(scope: string, home: string): LibrarySnapshot {
  try {
    const [top, commit] = git(home, ['rev-parse', '--show-toplevel', 'HEAD']).trim().split('\n')
    if (top === undefined || commit === undefined || !/^[0-9a-f]{40,64}$/.test(commit)) return { scope, commit: 'unknown' }
    // Git reports the physical path (e.g. macOS /var → /private/var), so both
    // sides are compared after resolving symlinks.
    if (realpathSync(top) !== realpathSync(home)) return { scope, commit: 'unknown' }
    // Only cards count: the kernel keeps its own untracked state (`.memex/`)
    // in the library root, which would otherwise mark every library dirty.
    const dirty = git(home, ['status', '--porcelain', '--', 'cards']).trim() !== ''
    return { scope, commit, dirty }
  } catch {
    return { scope, commit: 'unknown' }
  }
}

/** Short content hash: enough to tell card versions apart, small enough to keep records lean. */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** One-way hash of a session id, so records join with the session log without carrying the id. */
export function sessionHash(id: string): string {
  return contentHash(`dsh-memex:session:${id}`)
}

/**
 * Read one card's file and its version facts.
 *
 * Uses the kernel's own layout (`<home>/cards/<slug>.md`). A slug that would
 * resolve outside `cards/` is refused rather than read.
 *
 * @returns the content, its hash and `modified`; undefined when unreadable.
 */
export function cardFacts(home: string, slug: string): { readonly content: string; readonly hash: string; readonly modified?: string } | undefined {
  const cards = resolve(home, 'cards')
  const file = resolve(cards, `${slug}.md`)
  if (!file.startsWith(cards + sep)) return undefined
  let content: string
  try { content = readFileSync(file, 'utf8') } catch { return undefined }
  const modified = frontmatter(content).data.modified
  return {
    content,
    hash: contentHash(content),
    ...(typeof modified === 'string' && modified !== '' ? { modified } : {}),
  }
}
