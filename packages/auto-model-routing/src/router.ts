import { mapEffort, type Effort, type Reason, type Tier } from './effort.js'
import type { Distribution, JevCategory } from './jev.js'
import { userInput, type ClaimedMessage } from './input.js'
import type { Mode, RoutingState, Selection } from './state.js'
import { explicitMainEffort, SettingsValidationError } from './settings.js'
import { validateMainRoute } from './settings-validation.js'
import { DEFAULT_SETTINGS, type Settings, type RoutingCatalog } from './settings-contract.js'
export interface AgentRef { id: string; origin?: string }
export interface RequestConfig extends Selection { [key: string]: unknown }
interface Decision { effort?: Effort; reason: Reason; category?: JevCategory }
/** Latest successful Jev decision for a session, for the optional on-screen hint (memory only). */
export interface Judgement { id: number; source: 'main' | 'subagent'; tier: Tier; effort: Effort; model?: string; confidence?: number; probabilities?: Distribution; ms: number }
export type Measure = { confidence?: number; probabilities?: Distribution; ms: number }
interface Runtime {
  turn: number
  active: boolean
  pending: boolean
  previous?: Tier
  tier?: Tier
  measure?: Measure
  reason: Reason
  decision?: Decision
  decisionRoute?: string
  history: Decision[]
}
function withEffort(config: RequestConfig, effort?: Effort): RequestConfig {
  const { reasoningEffort: _, ...rest } = config
  return effort === undefined ? rest : { ...rest, reasoningEffort: effort }
}
export class Router {
  private readonly runtimes = new WeakMap<AgentRef, Runtime>()
  private readonly judgements = new Map<string, Judgement>()
  private sequence = 0
  /** `onJudged` fires once per successful main-session judgement, at the turn's first request (with or without an effort). */
  constructor(private readonly state: RoutingState, private readonly onJudged: (sessionId: string, turn: number, tier: Tier, model: string, effort?: Effort) => void = () => {}, private readonly readSettings: () => Settings = () => DEFAULT_SETTINGS) {}

  /** Remember the latest decision; the session id comes from the caller's own agent. */
  judged(sessionId: string, value: Omit<Judgement, 'id'>): void {
    this.judgements.delete(sessionId)
    this.judgements.set(sessionId, { id: ++this.sequence, ...value })
    // Bounded: drop the oldest sessions' entries (Map keeps insertion order).
    if (this.judgements.size > 200) this.judgements.delete(this.judgements.keys().next().value!)
  }

  judgement(sessionId: string): Judgement | undefined {
    const value = this.judgements.get(sessionId)
    return value && { ...value }
  }

  /** Open a turn. Returns the text to judge when this is an AUTO user turn; the caller then calls `resolve`. */
  begin(agent: AgentRef, turn: number, messages: readonly ClaimedMessage[]): { text: string; previous?: Tier } | undefined {
    if (agent.origin === 'subagent') return undefined
    const old = this.runtimes.get(agent)
    if (old?.turn === turn) return undefined
    const input = userInput(messages)
    const state = this.state.read(agent.id)
    const active = state.mode === 'AUTO' && (input.userTurn || old?.active === true)
    const judge = active && input.userTurn
    // Memory first; after a restart the persisted tier keeps "继续" anchored to the last judgement.
    const previous = old?.previous ?? state.previous
    const tier = judge ? undefined : previous
    this.runtimes.set(agent, {
      turn, active, pending: judge, reason: judge ? 'jev' : 'continued',
      ...(previous ? { previous } : {}),
      ...(tier ? { tier } : {}),
      history: old?.history ?? [],
    })
    return judge ? { text: input.text, ...(previous ? { previous } : {}) } : undefined
  }

  /** Apply the judged tier. Discarded when the turn moved on or the mode changed while judging. */
  resolve(agent: AgentRef, turn: number, tier: Tier, measure?: Measure): void {
    const runtime = this.settle(agent, turn)
    if (!runtime) return
    runtime.tier = tier
    this.state.remember(agent.id, tier)
    if (measure) runtime.measure = measure
    runtime.previous = tier
  }

  /** Jev failed: disable (MANUAL, no restore) and record why. Discarded like `resolve`. */
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

  request(agent: AgentRef, turn: number, config: RequestConfig, supported: readonly Effort[], catalog?: RoutingCatalog): RequestConfig {
    if (agent.origin === 'subagent') return config
    const runtime = this.runtimes.get(agent)
    if (!runtime || runtime.turn !== turn || !runtime.active || this.state.read(agent.id).mode !== 'AUTO') return config
    if (!runtime.tier) return config
    const settings = this.readSettings()
    // Revalidate before consulting the mapping cache: settings and model capabilities can change mid-turn.
    const explicit = explicitMainEffort(settings, config.provider, config.model, runtime.tier, catalog ?? {
      models: [{ provider: config.provider, model: config.model, name: config.model, reasoningEfforts: supported }],
      childAllowlist: { status: 'unavailable', allowedModels: [] },
    })
    if (explicit !== undefined) {
      const errors = validateMainRoute({ models: [{ provider: config.provider, model: config.model, name: config.model, reasoningEfforts: supported }], childAllowlist: { status: 'unavailable', allowedModels: [] } }, config.provider, config.model, explicit, settings.effortCap, `mainEfforts.${config.provider}.${runtime.tier}`)
      if (errors.length) throw new SettingsValidationError(errors)
    }
    const effort = explicit ?? mapEffort(config.model, runtime.tier, supported, settings.effortCap)
    const route = `${config.provider}\0${config.model}\0${supported.join(',')}\0${effort ?? ''}`
    if (!runtime.decision || runtime.decisionRoute !== route) {
      runtime.decisionRoute = route
      const reason = effort === undefined ? 'no-effort-support' : runtime.reason
      runtime.decision = { ...(effort ? { effort } : {}), reason }
      this.record(runtime, runtime.decision)
      // Only a fresh Jev judgement is announced and logged; continued turns and remaps of it are not.
      if (runtime.measure) {
        if (effort) this.judged(agent.id, { source: 'main', tier: runtime.tier, effort, ...runtime.measure })
        this.onJudged(agent.id, turn, runtime.tier, config.model, effort)
        delete runtime.measure
      }
    }
    return runtime.decision.effort ? withEffort(config, runtime.decision.effort) : config
  }

  needsModelInfo(agent: AgentRef): boolean {
    const state = this.state.read(agent.id)
    const runtime = this.runtimes.get(agent)
    return agent.origin !== 'subagent' && state.mode === 'AUTO' && runtime?.active === true && runtime.tier !== undefined
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
