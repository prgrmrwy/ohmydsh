import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { OperationRecord } from '../wire.js'
import { bindingOf } from '../wire.js'
import { installContext } from './context.js'
import { installGuard } from './guard.js'

/** Live source Session id → bound operation, seeded by the Host routes. */
const survey = new Map<string, OperationRecord>()
const guards = new WeakMap<Agent, () => void>()
let continuableDelegationTools: readonly string[] = []

export function configureContinuableDelegationTools(names: readonly string[]): void {
  continuableDelegationTools = [...new Set(names)]
}

/** Resolve the bound operation record for a live Agent, if any. */
export function findOperationForSession(agent: Agent | undefined): OperationRecord | undefined {
  if (agent === undefined) return undefined
  return survey.get(agent.session.id as string)
}

function refreshAgent(agent: Agent | undefined, operation: OperationRecord | undefined, validationFailure?: string): void {
  if (agent === undefined) return
  const previous = guards.get(agent)
  if (previous !== undefined) { previous(); guards.delete(agent) }
  installContext(agent, operation)
  if (operation === undefined) return
  const binding = bindingOf(operation)
  // Every current source binding keeps a guard. Cleaned and cleaned-archived
  // reach checkTool's terminal deny-all branch; released history installs none.
  if (binding?.mode === 'source-session' && binding.state !== 'released') guards.set(agent, installGuard(agent, operation, validationFailure, continuableDelegationTools))
}

/**
 * Record the durable operation for a bound source Session and install the
 * stable runtime context + tool guard into the live Agent (if it exists yet).
 * Idempotent per Agent and safe to call on resume or after Host restart.
 */
export function rememberBind(ctx: Context, sourceSessionId: string, operation: OperationRecord | undefined, validationFailure?: string): void {
  const current = operation !== undefined && bindingOf(operation)?.state !== 'released' ? operation : undefined
  if (current === undefined) survey.delete(sourceSessionId)
  else survey.set(sourceSessionId, current)
  refreshAgent(ctx.agents.get(sourceSessionId as never), current, validationFailure)
}

/** Re-install the recorded context/guard for a Session whose Agent just came live. */
export function refreshPolicy(ctx: Context, sourceSessionId: string): void {
  const operation = survey.get(sourceSessionId)
  refreshAgent(ctx.agents.get(sourceSessionId as never), operation)
}

/**
 * Compose the parent Worktree binding into every continuable subagent before its
 * publication/first step. The subagent runtime invokes this contribution for
 * fresh children and cold resumes. Missing or conflicting lineage throws during
 * unpublished setup, so the delegation is rolled back rather than starting in
 * the source checkout.
 */
export function installSubagentInheritance(childCtx: Context): () => void {
  const child = childCtx.agent
  if (child === undefined) throw new Error('Worktree Session cannot install delegated policy without an unpublished child Agent')
  const parentId = child.session.header.parentSession as string | undefined
  if (parentId === undefined) return () => {}
  const operation = survey.get(parentId)
  if (operation === undefined) return () => {}
  const binding = bindingOf(operation)
  if (binding?.mode !== 'source-session' || binding.sourceSessionId !== parentId) throw new Error(`Worktree Session cannot prove parent binding for delegated Agent ${child.id as string}`)
  refreshAgent(child, operation)
  return () => {
    const guard = guards.get(child)
    if (guard !== undefined) { guard(); guards.delete(child) }
    installContext(child, undefined)
  }
}

export function registerSubagentInheritance(ctx: Context): () => void {
  return ctx.subagents.registerContinuableSetup(installSubagentInheritance)
}

/** Source Sessions currently protected by a live Agent or retained live Session. */
export function activeBoundSessionIds(ctx: Context): readonly string[] {
  return [...survey.entries()].flatMap(([sessionId, operation]) => {
    const binding = bindingOf(operation)
    if (binding?.mode !== 'source-session' || binding.state === 'cleaned' || binding.state === 'cleaned-archived' || binding.state === 'released') return []
    return ctx.agents.get(sessionId as never) !== undefined || ctx.sessions.get(sessionId as never) !== undefined ? [sessionId] : []
  })
}
