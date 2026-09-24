/**
 * Optional Worktree Session status reader, used to ENRICH a source snapshot.
 *
 * This is runtime context, not a capability adapter: it tells Pet where a
 * session's managed execution root is, so `pet_context` can hand any Skill a
 * trustworthy directory instead of letting it guess from prose. Pet performs
 * no worktree effects of its own — a Skill that wants to clean or promote a
 * worktree drives the existing `ws` tooling itself.
 */

import { createRequire } from 'node:module'

/** The subset of Worktree Session status Pet reads. */
export interface WorktreeStatusReader {
  wsStatus(target: {
    sessionId: string
    repoPath: string
  }): Promise<{
    worktreePath: string
    taskBranch: string
    dependencyMode: string
    phase: string
  }>
}

/**
 * Load the optional Worktree Session status reader.
 *
 * An absent peer is a normal deployment, not a fault: snapshots simply carry
 * no managed-worktree fields.
 * @returns the reader, or `undefined` when the peer is not installed.
 */
export async function loadWorktreeStatus(): Promise<WorktreeStatusReader | undefined> {
  try {
    const require = createRequire(import.meta.url)
    const loaded = require('dsh-worktree-session') as { wsStatus?: unknown }
    if (typeof loaded.wsStatus !== 'function') return undefined
    return loaded as WorktreeStatusReader
  } catch {
    return undefined
  }
}
