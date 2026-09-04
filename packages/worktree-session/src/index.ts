import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { createRoutes } from './host/http.js'
import { registerArchiveLifecycle, reconcileSessionSnapshot } from './host/archive.js'
import { activeBoundSessionIds as boundSessionIds, configureContinuableDelegationTools, registerSubagentInheritance, rememberBind } from './host/policy.js'
import { WsError } from './host/errors.js'
import { releaseMissingWorktreeBinding } from './host/operation.js'
import { recoverBindingSync } from './host/recovery.js'
import { registerWsTool } from './host/tool.js'
import { bindingOf, type OperationRecord } from './wire.js'

export const name = 'worktree-session'
export const inject = ['webServer', 'sessions', 'agents', 'tools', 'systemPrompt', 'subagents', 'workspaceRegistry', 'storageDomain']

export interface Config { continuableDelegationTools?: readonly string[] }

export function apply(ctx: Context, config: Config = {}): void {
  configureContinuableDelegationTools(config.continuableDelegationTools ?? [])
  const activeSessionPaths = (): readonly string[] => ctx.sessions.list().flatMap(session => session.header.cwd === undefined ? [] : [session.header.cwd])
  // Record bound operations and install their stable Agent context. Idempotent
  // per Agent; safe on first bind and on resume after Host restart.
  const recordBind = (sourceSessionId: string, operation: OperationRecord | undefined): void => {
    rememberBind(ctx, sourceSessionId, operation)
  }
  const bindLiveSource = (sourceSessionId: string, operation: OperationRecord, options: { requireBlank: boolean }): void => {
    const session = ctx.sessions.get(sourceSessionId as SessionId)
    if (session === undefined) throw new WsError('OPERATION_CONFLICT', `Source Session ${sourceSessionId} is not live`)
    if (session.header.cwd !== operation.repoRoot) throw new WsError('OPERATION_CONFLICT', `Source Session cwd ${session.header.cwd ?? '(none)'} does not equal repository ${operation.repoRoot}`)
    if (options.requireBlank && session.events.some(event => event.type === 'turn/start')) throw new WsError('OPERATION_CONFLICT', 'Source Session is no longer blank')
    const agent = ctx.agents.get(sourceSessionId as SessionId)
    if (agent === undefined) throw new WsError('OPERATION_CONFLICT', `Source Agent ${sourceSessionId} is not live`)
    rememberBind(ctx, sourceSessionId, operation)
  }
  const recoverAgent = (agent: ReturnType<typeof ctx.agents.get>): void => {
    if (agent === undefined) return
    const sourceSessionId = agent.session.id as string
    const recovered = recoverBindingSync(agent.session.header.cwd, sourceSessionId)
    // The managed worktree is gone, so this is no longer a Worktree Session.
    // Skip installing the binding at all: doing it here, synchronously, is what
    // keeps the first turn from running under a deny-all guard that the async
    // persistence below would only lift on some later session-start.
    if (recovered?.worktreeGone === true) {
      rememberBind(ctx, sourceSessionId, undefined)
      void releaseMissingWorktreeBinding({ gitCommonDir: recovered.operation.gitCommonDir, sourceSessionId }).catch(error => {
        ctx.logger.warn(`worktree-session release of missing worktree failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      return
    }
    // Legacy cleaned tombstones need the durable snapshot reconciled before any
    // old deny-all policy can be installed during the compatibility window.
    const recoveredBinding = recovered === undefined ? undefined : bindingOf(recovered.operation)
    if (recovered !== undefined && !(recoveredBinding?.state === 'cleaned' && recoveredBinding.archiveLifecycle === undefined)) {
      rememberBind(ctx, sourceSessionId, recovered.operation, recovered.valid ? undefined : recovered.diagnostic)
    }
    void reconcileSessionSnapshot(ctx, sourceSessionId, { recordBind }).catch(error => {
      ctx.logger.warn(`worktree-session recovery reconciliation failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  // session-start is synchronously emitted before the first driver step; install
  // restored policy before the event returns. Also rescue Agents already live if
  // this plugin hot-loads after their publication.
  ctx.on('agent/session-start', ({ agent }) => { recoverAgent(agent) })
  registerSubagentInheritance(ctx)
  ctx.effect(() => registerArchiveLifecycle(ctx, { recordBind }), 'worktree-session: observe durable archive lifecycle')
  for (const agent of ctx.agents.list()) recoverAgent(agent)
  ctx.effect(() => registerWsTool(ctx), 'worktree-session: register Session-oriented ws tool')
  for (const route of createRoutes({ activeSessionPaths, activeBoundSessionIds: () => boundSessionIds(ctx), recordBind, bindLiveSource, reconcileSession: sourceSessionId => reconcileSessionSnapshot(ctx, sourceSessionId, { recordBind }) })) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }), `worktree-session: ${route.path}`)
  }
}

export * from './wire.js'
export { startOperation, loadOperation } from './host/operation.js'
export { wsStatus, wsPromote, wsClean } from './host/maintenance.js'
