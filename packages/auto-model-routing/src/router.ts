import { mapEffort, type Effort, type Reason, type Tier } from './effort.js'
import type { JevCategory } from './jev.js'
import { userInput, type ClaimedMessage } from './input.js'
import type { Mode, RoutingState, Selection } from './state.js'
export interface AgentRef { id: string; origin?: string }
export interface RequestConfig extends Selection { [key: string]: unknown }
interface Decision { effort?: Effort; reason: Reason; category?: JevCategory }
interface Runtime {
  turn: number
  active: boolean
  pending: boolean
  previous?: Tier
  tier?: Tier
  reason: Reason
  decision?: Decision
  decisionRoute?: string
  history: Decision[]
}
function same(a: Selection | undefined, b: Selection): boolean {
  return a?.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
}
function withEffort(config: RequestConfig, effort?: Effort): RequestConfig {
  const { reasoningEffort: _, ...rest } = config
  return effort === undefined ? rest : { ...rest, reasoningEffort: effort }
}
export class Router {
  private readonly runtimes = new WeakMap<AgentRef, Runtime>()
  constructor(private readonly state: RoutingState) {}

  /** Open a turn. Returns the text to judge when this is an AUTO user turn; the caller then calls `resolve`. */
  begin(agent: AgentRef, turn: number, messages: readonly ClaimedMessage[]): { text: string; previous?: Tier } | undefined {
    if (agent.origin === 'subagent') return undefined
    const old = this.runtimes.get(agent)
    if (old?.turn === turn) return undefined
    const input = userInput(messages)
    const state = this.state.read(agent.id)
    const active = state.mode === 'AUTO' && !state.restore && (input.userTurn || old?.active === true)
    const judge = active && input.userTurn
    const tier = judge ? undefined : old?.previous
    this.runtimes.set(agent, {
      turn, active, pending: judge, reason: judge ? 'jev' : 'continued',
      ...(old?.previous ? { previous: old.previous } : {}),
      ...(tier ? { tier } : {}),
      history: old?.history ?? [],
    })
    return judge ? { text: input.text, ...(old?.previous ? { previous: old.previous } : {}) } : undefined
  }

  /** Apply the judged tier. Discarded when the turn moved on or the mode changed while judging. */
  resolve(agent: AgentRef, turn: number, tier: Tier): void {
    const runtime = this.settle(agent, turn)
    if (!runtime) return
    runtime.tier = tier
    runtime.previous = tier
  }

  /** Jev failed: disable (MANUAL + restore) and record why. Discarded like `resolve`. */
  fail(agent: AgentRef, turn: number, category: JevCategory): void {
    const runtime = this.settle(agent, turn)
    if (!runtime) return
    runtime.active = false
    this.state.disable(agent.id, category)
    this.record(runtime, { reason: 'jev-failed', category })
  }

  /** Cancelled: this turn is not rewritten, nothing is disabled. */
  cancel(agent: AgentRef, turn: number): void {
    const runtime = this.settle(agent, turn)
    if (runtime) runtime.active = false
  }

  private settle(agent: AgentRef, turn: number): Runtime | undefined {
    const runtime = this.runtimes.get(agent)
    if (!runtime || runtime.turn !== turn || !runtime.pending) return undefined
    runtime.pending = false
    return runtime.active ? runtime : undefined
  }

  setMode(agent: AgentRef, mode: Mode): void {
    if (this.state.read(agent.id).mode === mode) return
    this.state.setMode(agent.id, mode)
    const runtime = this.runtimes.get(agent)
    if (runtime) {
      runtime.active = false
      delete runtime.decision
    }
  }

  request(agent: AgentRef, turn: number, config: RequestConfig, supported: readonly Effort[], header?: Selection): RequestConfig {
    if (agent.origin === 'subagent') return config
    const state = this.state.initialize(agent.id, config)
    const runtime = this.runtimes.get(agent)
    if (state.restore && state.anchor) {
      const anchor = state.anchor
      if (config.provider !== anchor.provider || config.model !== anchor.model) return config
      if (same(header, anchor) && same(config, anchor)) {
        this.state.completeRestore(agent.id)
        return config
      }
      this.record(runtime, { ...(anchor.reasoningEffort ? { effort: anchor.reasoningEffort } : {}), reason: 'manual-restore' })
      return withEffort(config, anchor.reasoningEffort)
    }
    if (!runtime || runtime.turn !== turn || !runtime.active || state.mode !== 'AUTO') return config
    const route = `${config.provider}\0${config.model}\0${supported.join(',')}`
    if (!runtime.decision || runtime.decisionRoute !== route) {
      runtime.decisionRoute = route
      if (!runtime.tier) return config
      const effort = mapEffort(config.model, runtime.tier, supported)
      const reason = effort === undefined ? 'no-effort-support' : runtime.reason
      runtime.decision = { ...(effort ? { effort } : {}), reason }
      this.record(runtime, runtime.decision)
    }
    return runtime.decision.effort ? withEffort(config, runtime.decision.effort) : config
  }

  needsModelInfo(agent: AgentRef): boolean {
    const state = this.state.read(agent.id)
    const runtime = this.runtimes.get(agent)
    return agent.origin !== 'subagent' && state.mode === 'AUTO' && !state.restore && runtime?.active === true && runtime.tier !== undefined
  }

  status(agent: AgentRef): { effort?: Effort; reason?: Reason; history: readonly Decision[] } {
    const runtime = this.runtimes.get(agent)
    const history = runtime?.history ?? []
    return { ...history.at(-1), history: history.map(item => ({ ...item })) }
  }

  private record(runtime: Runtime | undefined, decision: Decision): void {
    if (!runtime) return
    runtime.history.push(decision)
    if (runtime.history.length > 20) runtime.history.shift()
  }
}
