import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { InquiryScope } from './ledger.js'
import type { InquiryExecutionProof } from './agent-adapter.js'

export type ManagedEffect = 'communication' | 'delegation' | 'delivery' | 'todo-execution' | 'authority-mutation'
export interface ManagedExecution extends Pick<ToolExecution, 'name' | 'agent' | 'parent' | 'token'> {}
export interface ManagedEffectsOptions {
  /** Host-owned, execution-token-bound proof. Never derive this from tool args. */
  readonly proofForExecution: (agentId: string, execution: ManagedExecution) => InquiryExecutionProof | undefined
  readonly currentScope: (agentId: string) => InquiryScope | undefined
}
export interface ManagedEffectsRegistry {
  register(definition: ToolDefinition, effect: ManagedEffect): () => void
  install(agent: Agent, proofForExecution: ManagedEffectsOptions['proofForExecution'], currentScope: ManagedEffectsOptions['currentScope']): () => void
  /** Synchronous final check for managed bodies after async wrappers settle. */
  assertEntry(execution: ManagedExecution): void
  /** Reports guard installation only; it does not certify catalog coverage. */
  installed(agentId: string): boolean
}

export class ManagedEffectDeniedError extends Error {
  readonly code = 'INQUIRY_MANAGED_EFFECT_DENIED'
  constructor() { super('Managed effect is unavailable during inquiry target work') }
}

const TARGET = 'target'
/** Host-only intrinsic marker; native owners annotate the actual execute function. */
export const MANAGED_EFFECT_ANNOTATION = Symbol.for('dsh.tool.managed-effect')
const CATALOG_MANAGED_EFFECTS = new Set<ManagedEffect>(['communication', 'delegation'])
function sameScope(a: InquiryScope | undefined, b: InquiryScope | undefined): boolean {
  if (!a || !b || a.kind !== b.kind || a.sessionId !== b.sessionId) return false
  return a.kind === 'main' || (b.kind === 'child' && a.locusId === b.locusId && a.generation === b.generation)
}
function validTarget(proof: InquiryExecutionProof | undefined, agentId: string, scope: InquiryScope | undefined): boolean {
  return !!proof && proof.sessionId === agentId && Number.isSafeInteger(proof.turn) && proof.turn > 0 && proof.active && !proof.signal.aborted && !!proof.inquirySegment && proof.inquirySegment.phase === TARGET && sameScope(proof.scope, scope)
}

/**
 * Identity-based registry for explicitly owner-marked managed tools. This is a guard primitive,
 * not production catalog coverage: each native owner must register its actual definitions.
 */
export function createInquiryManagedEffects(): ManagedEffectsRegistry {
  const definitions = new WeakMap<ToolDefinition, { effect: ManagedEffect; count: number }>()
  const bodies = new WeakMap<ToolDefinition['execute'], number>()
  type Actor = {
    readonly agent: Agent
    readonly proofForExecution: ManagedEffectsOptions['proofForExecution']
    readonly currentScope: ManagedEffectsOptions['currentScope']
    /** Kept until actor disposal: an already-captured target must survive revocation/lookups vanishing. */
    readonly capturedTargets: Map<ToolExecution['token'], InquiryExecutionProof>
  }
  const actors = new Map<string, Actor>()
  const removeCount = <K extends object>(map: WeakMap<K, number>, key: K) => {
    const count = (map.get(key) ?? 1) - 1
    if (count <= 0) map.delete(key); else map.set(key, count)
  }
  const isMarked = (definition: ToolDefinition | undefined) => {
    if (!definition) return false
    if (definitions.has(definition) || bodies.has(definition.execute)) return true
    const annotation = Object.getOwnPropertyDescriptor(definition.execute, MANAGED_EFFECT_ANNOTATION)
    // Any own annotation is managed: unknown values fail closed as catalog maintenance gaps.
    return annotation !== undefined
  }

  return {
    register(definition, effect) {
      let row = definitions.get(definition)
      if (!row) { row = { effect, count: 0 }; definitions.set(definition, row) }
      if (row.effect !== effect) throw new Error('ToolDefinition already registered with a different managed effect')
      row.count++
      bodies.set(definition.execute, (bodies.get(definition.execute) ?? 0) + 1)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        const current = definitions.get(definition)
        if (current && --current.count === 0) definitions.delete(definition)
        removeCount(bodies, definition.execute)
      }
    },
    install(agent, proofForExecution, currentScope) {
      const agentId = agent.id
      if (actors.has(agentId)) throw new Error(`Managed effects already installed for agent ${agentId}`)
      const actor: Actor = { agent, proofForExecution, currentScope, capturedTargets: new Map() }
      actors.set(agentId, actor)
      const context = agent.ctx as Context & {
        on: (event: string, listener: (...args: any[]) => any) => () => void
        tools: {
          guard(guard: (exec: ManagedExecution) => string | undefined): () => void
          get(name: string, agent?: Agent): ToolDefinition | undefined
        }
      }
      const capture = (exec: ManagedExecution) => {
        const proof = proofForExecution(agentId, exec)
        if (proof?.inquirySegment?.phase === TARGET && !actor.capturedTargets.has(exec.token)) actor.capturedTargets.set(exec.token, proof)
        return proof
      }
      const resolve = (exec: ManagedExecution) => {
        const definition = context.tools.get(exec.name, exec.agent)
        return { definition, marked: isMarked(definition) }
      }
      const removeCapture = context.on('tools/pre-execute', async (exec: ManagedExecution, next: () => Promise<unknown>) => {
        if (exec.agent?.id !== agentId) return next()
        const proof = capture(exec)
        // Target proof is immutable provenance. Capture before wrappers can revoke or erase it.
        if (proof?.inquirySegment?.phase === TARGET) return next()
        const decision = await next()
        capture(exec)
        return decision
      })
      const disposeGuard = context.tools.guard(exec => {
        if (exec.agent && exec.agent.id !== agentId) return undefined
        const { marked } = resolve(exec)
        if (!marked) return undefined
        const proof = actor.capturedTargets.get(exec.token) ?? capture(exec)
        if (proof?.inquirySegment?.phase === TARGET) {
          if (!validTarget(proof, agentId, actor.currentScope(agentId) ?? undefined)) return 'Managed effect denied: stale or invalid inquiry target proof'
          return 'Managed effect denied during inquiry target work'
        }
        // If this is a nested execution whose parent was captured as a target, proof resolvers
        // may only know the parent. Guard against an unavailable child lookup without fallback.
        if (!proof && exec.parent && actor.capturedTargets.has(exec.parent)) return 'Managed effect denied: missing child proof for inquiry target work'
        return undefined
      })
      return () => {
        if (actors.get(agentId) !== actor) return
        disposeGuard()
        removeCapture()
        actor.capturedTargets.clear()
        actors.delete(agentId)
      }
    },
    assertEntry(execution) {
      const agent = execution.agent
      const agentId = agent?.id
      if (!agent || !agentId) throw new ManagedEffectDeniedError()
      const actor = actors.get(agentId)
      const context = agent.ctx as Agent['ctx'] & { tools: { get(name: string, agent?: Agent): ToolDefinition | undefined } }
      if (!isMarked(context.tools.get(execution.name, agent))) return
      if (!actor) throw new ManagedEffectDeniedError()
      const captured = actor.capturedTargets.get(execution.token)
      const proof = captured ?? actor.proofForExecution(agentId, execution)
      if (proof?.inquirySegment?.phase === TARGET) throw new ManagedEffectDeniedError()
      if (!proof && execution.parent && actor.capturedTargets.has(execution.parent)) throw new ManagedEffectDeniedError()
    },
    installed(agentId) { return actors.has(agentId) },
  }
}
