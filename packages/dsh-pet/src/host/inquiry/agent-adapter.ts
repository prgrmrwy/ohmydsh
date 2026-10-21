import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { InquiryScope } from './ledger.js'
import type { InquiryPreStep } from './runtime.js'
import type { InquiryWork, InquiryWorkStore } from './work-store.js'

/** Runtime supplies the authenticated member scope; the adapter only owns local GUI roots. */
export interface InquiryAgentAdapterOptions {
  readonly currentScope: (sessionId: string) => InquiryScope | undefined
  readonly works: InquiryWorkStore
  readonly runtime?: Pick<ReturnType<typeof import('./runtime.js').createInquiryRuntime>, 'segmentFor' | 'install'>
  readonly now: () => number
}

/** A root's identity is useful only while its captured turn remains live. */
export interface InquiryExecutionProof {
  readonly sessionId: string
  readonly turn: number
  readonly scope: InquiryScope
  readonly rootWork?: InquiryWork
  readonly inquirySegment?: ReturnType<NonNullable<InquiryAgentAdapterOptions['runtime']>['segmentFor']>
  readonly signal: AbortSignal
  readonly active: boolean
}

/** Stable host-facing adapter over one official live Agent instance. */
export interface InquiryAgent {
  readonly session: Agent['session']
  readonly occupiesRunSlot: boolean
  readonly inbox: Agent['inbox']
  followup(message: UserMessage): void
  currentWork(turn: number): InquiryWork | undefined
  executionProof(execution: ToolExecution): InquiryExecutionProof | undefined
  on(event: 'agent/pre-step', listener: (payload: InquiryPreStep, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>): void
  on(event: 'agent/turn-end', listener: (payload: { readonly turn: number }) => void | Promise<void>): void
  installRuntime(runtime: NonNullable<InquiryAgentAdapterOptions['runtime']>): void
}

type CapturedTurn = { readonly turn: number; readonly scope: InquiryScope; readonly controller: AbortController; readonly work?: InquiryWork; active: boolean }
type PreStep = Omit<InquiryPreStep, 'messages'> & { readonly messages: readonly UserMessage[] }
type PreStepDecision = import('@deepseek-ai/dsh-agent').PreStepDecision

/**
 * Adapt real Agent lifecycle and tool waterfalls without mutating the global Agent prototype.
 * @param agent - published live Agent whose Context owns all listeners.
 * @param options - current scope resolver, durable local work store, and clock.
 * @returns stable adapter plus turn- and execution-bound provenance lookups.
 */
export function createInquiryAgentAdapter(agent: Agent, options: InquiryAgentAdapterOptions): InquiryAgent {
  const turns = new Map<number, CapturedTurn>()
  const executions = new Map<ToolExecutionToken, InquiryExecutionProof>()
  let runtime = options.runtime
  const preStepListeners: Array<(payload: InquiryPreStep, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>> = []
  const turnEndListeners: Array<(payload: { readonly turn: number }) => void | Promise<void>> = []
  let adapter!: InquiryAgent
  const agentId = agent.id
  const context = agent.ctx
  const sameScope = (a: InquiryScope, b: InquiryScope) => a.kind === b.kind && a.sessionId === b.sessionId && (a.kind === 'main' || (b.kind === 'child' && a.locusId === b.locusId && a.generation === b.generation))

  context.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const step = payload as PreStep & { agent: Agent }
    if (payload.agent.id !== agentId) return next()
    const captured = turns.get(payload.turn)
    const scope = options.currentScope(agentId)
    if (!scope) return next()
    let turn = captured
    if (!turn || !turn.active) {
      const roots = step.messages.filter(message => message.source?.kind === 'user')
      turn = { turn: payload.turn, scope, controller: new AbortController(), active: true }
      if (roots.length === 1) {
        const work = await options.works.claimLocalWork(scope, roots[0]!.id, payload.turn, options.now())
        turn = { ...turn, work }
      }
      turns.set(payload.turn, turn)
      if (payload.signal) {
        if (payload.signal.aborted) turn.controller.abort(payload.signal.reason)
        else payload.signal.addEventListener('abort', () => turn!.controller.abort(payload.signal?.reason), { once: true })
      }
    }
    // Every step still traverses runtime listeners; the captured root remains immutable.
    let index = -1
    const run = async (position: number): Promise<PreStepDecision> => {
      if (position <= index) throw new Error('Inquiry pre-step listeners must call next once')
      index = position
      const listener = preStepListeners[position]
      return listener ? listener(step, () => run(position + 1)) : next()
    }
    return run(0)
  })

  context.on('session/event', (session, event) => {
    if (session.id !== agentId || event.type !== 'turn/end') return
    const turn = event.data.turn
    const captured = turns.get(turn)
    if (!captured) return
    captured.active = false
    for (const [token, proof] of executions) if (proof.turn === turn && proof.sessionId === agentId) executions.delete(token)
    void (async () => {
      try {
        if (captured.work && sameScope(captured.scope, options.currentScope(agentId) ?? captured.scope)) {
          await options.works.endTurn(captured.scope, captured.work.workId, turn)
        }
      } catch { /* lifecycle dispatch is synchronous; cleanup failure is contained */ }
      finally {
        turns.delete(turn)
        await agent.whenIdle().catch(() => undefined)
        for (const listener of turnEndListeners) {
          try { await listener({ turn }) } catch { /* isolate independent runtime listeners */ }
        }
      }
    })()
  })

  context.on('tools/pre-execute', async (execution, next) => {
    if (execution.agent?.id !== agentId) return next()
    let captured = execution.parent ? executions.get(execution.parent) : undefined
    if (!captured && !execution.parent) {
      const active = [...turns.values()].filter(value => value.active)
      if (active.length === 1) {
        const turn = active[0]!
        captured = Object.freeze({
          sessionId: agentId,
          turn: turn.turn,
          scope: turn.scope,
          ...(turn.work ? { rootWork: turn.work } : {}),
          ...(runtime?.segmentFor(agentId, turn.turn) ? { inquirySegment: runtime.segmentFor(agentId, turn.turn) } : {}),
          signal: turn.controller.signal,
          get active() { return turn.active && !turn.controller.signal.aborted },
        })
      }
    }
    if (captured) executions.set(execution.token, captured)
    const result = await next()
    return result
  })

  adapter = Object.freeze({
    session: agent.session,
    get occupiesRunSlot() { return agent.status !== 'idle' },
    get inbox() { return agent.inbox },
    followup(message: Parameters<Agent['followup']>[0]) { agent.followup(message) },
    currentWork(turn: number) { return turns.get(turn)?.work },
    executionProof(execution: ToolExecution) {
      const proof = executions.get(execution.token)
      if (proof) return proof
      return execution.parent ? executions.get(execution.parent) : undefined
    },
    on(event: 'agent/pre-step' | 'agent/turn-end', listener: ((payload: InquiryPreStep, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>) | ((payload: { readonly turn: number }) => void | Promise<void>)) {
      if (event === 'agent/pre-step') preStepListeners.push(listener as (payload: InquiryPreStep, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>)
      else turnEndListeners.push(listener as (payload: { readonly turn: number }) => void | Promise<void>)
    },
    installRuntime(value: NonNullable<InquiryAgentAdapterOptions['runtime']>) {
      if (runtime === value) return
      if (runtime) throw new Error('Inquiry runtime already installed')
      runtime = value
      const scope = options.currentScope(agentId)
      if (scope) value.install(adapter, scope)
    },
  })
  if (runtime) {
    const scope = options.currentScope(agentId)
    if (scope) runtime.install(adapter, scope)
  }
  return adapter
}
