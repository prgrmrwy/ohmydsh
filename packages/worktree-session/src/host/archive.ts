import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { OperationRecord } from '../wire.js'
import { discoverRepo } from './git.js'
import { findBySourceSession, reconcileSourceArchiveLifecycle, type ArchiveReconcileMode } from './operation.js'

export interface ArchiveLifecycleDeps {
  recordBind(sourceSessionId: string, operation: OperationRecord | undefined): void
}

function repositoryForSession(ctx: Context, sourceSessionId: string): string | undefined {
  const live = ctx.sessions.get(sourceSessionId as SessionId)
  if (live?.header.cwd !== undefined) return live.header.cwd
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (workspace.sessionIds.some(id => String(id) === sourceSessionId)) return workspace.path
  }
  return undefined
}

async function reconcileOne(ctx: Context, sourceSessionId: string, archived: boolean, mode: ArchiveReconcileMode, deps: ArchiveLifecycleDeps): Promise<void> {
  const repoPath = repositoryForSession(ctx, sourceSessionId)
  if (repoPath === undefined) return
  try {
    const repo = await discoverRepo(repoPath)
    await reconcileSourceArchiveLifecycle({ gitCommonDir: repo.gitCommonDir, sourceSessionId, archived, mode })
    deps.recordBind(sourceSessionId, await findBySourceSession(repo.gitCommonDir, sourceSessionId))
  } catch (error) {
    ctx.logger.warn(`worktree-session archive reconciliation skipped for ${sourceSessionId}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Observe only durable workspace-global writes. The first snapshot is seeded
 * from WorkspaceRegistry; subsequent membership diffs prove archive edges.
 */
export function registerArchiveLifecycle(ctx: Context, deps: ArchiveLifecycleDeps): () => void {
  let previous = new Set(ctx.workspaceRegistry.archivedSessionIds.map(String))
  let tail = Promise.resolve()
  const enqueue = (work: () => Promise<void>): void => {
    tail = tail.then(work).catch(error => {
      ctx.logger.warn(`worktree-session archive observer failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const knownSessionIds = new Set<string>()
  for (const workspace of ctx.workspaceRegistry.list()) for (const id of workspace.sessionIds) knownSessionIds.add(String(id))
  for (const id of knownSessionIds) {
    enqueue(() => reconcileOne(ctx, id, previous.has(id), 'current-snapshot', deps))
  }

  return ctx.on('domain/changed', change => {
    if (change.domain !== 'workspace' || change.table !== '' || change.key !== '' || change.operation !== 'put') return
    const state = workspaceDomainState.parse(change.value)
    const next = new Set(state.archivedSessionIds.map(String))
    const changed = new Set([...previous, ...next])
    for (const id of changed) {
      const before = previous.has(id)
      const after = next.has(id)
      if (before === after) continue
      enqueue(() => reconcileOne(ctx, id, after, after ? 'archive-observed' : 'unarchive-observed', deps))
    }
    previous = next
  })
}

/** Race-safe status/recovery fallback using the current durable snapshot. */
export async function reconcileSessionSnapshot(ctx: Context, sourceSessionId: string, deps: ArchiveLifecycleDeps): Promise<void> {
  await reconcileOne(ctx, sourceSessionId, ctx.workspaceRegistry.archivedSessionIds.some(id => String(id) === sourceSessionId), 'current-snapshot', deps)
}
