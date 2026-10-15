import { mapEffort, resolveLevel, type Effort, type Level, type Reason } from './classifier.js'
import { userInput, type ClaimedMessage } from './input.js'
import type { Mode, RoutingState, Selection } from './state.js'
export interface AgentRef { id: string; origin?: string }
export interface RequestConfig extends Selection { [key: string]: unknown }
interface Decision { effort?: Effort; reason: Reason }
interface Runtime {
  turn: number
  active: boolean
  previous?: Level
  level?: Level
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

  begin(agent: AgentRef, turn: number, messages: readonly ClaimedMessage[]): void {
    if (agent.origin === 'subagent') return
    const old = this.runtimes.get(agent)
    if (old?.turn === turn) return
    const input = userInput(messages)
    const state = this.state.read(agent.id)
    const active = state.mode === 'AUTO' && !state.restore && (input.userTurn || old?.active === true)
    const result = active && input.userTurn ? resolveLevel(input.text, old?.previous) : { reason: 'continued' as const, ...(old?.previous ? { level: old.previous } : {}) }
    const previous = input.userTurn && active ? result.level : old?.previous
    this.runtimes.set(agent, {
      turn, active, reason: result.reason,
      ...(result.level ? { level: result.level } : {}),
      ...(previous ? { previous } : {}),
      history: old?.history ?? [],
    })
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
      const effort = runtime.level ? mapEffort(config.model, runtime.level, supported) : undefined
      const reason = !runtime.level ? 'unclassified' : effort === undefined ? 'no-effort-support' : runtime.reason
      runtime.decision = { ...(effort ? { effort } : {}), reason }
      this.record(runtime, runtime.decision)
    }
    return runtime.decision.effort ? withEffort(config, runtime.decision.effort) : config
  }

  needsModelInfo(agent: AgentRef): boolean {
    const state = this.state.read(agent.id)
    return agent.origin !== 'subagent' && state.mode === 'AUTO' && !state.restore && this.runtimes.get(agent)?.active === true
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
