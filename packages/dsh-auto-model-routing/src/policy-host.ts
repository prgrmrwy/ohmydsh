import type { FeedbackBook } from './feedback.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import type { JevClient, Depth, PolicyMeasure } from './jev.js'
import { CATEGORY_HINTS } from './jev.js'
import { chooseChildRoute, policyEffort, validatePolicyRoute } from './routing.js'
import { registry as builtin, type Registry } from './strategies/index.js'
import { PolicyStore, type ChildDecision } from './policy-store.js'
import type { RoutingState } from './state.js'
import type { AutomaticEffort, RoutingCatalog, Settings } from './settings-contract.js'
import { userInput } from './input.js'
import { buildState, previousTurn, redact } from './context.js'
import { isRecord } from './settings-validation.js'
import { autoSupportedModel, currentMainSelection, mainSupported } from './support.js'
import { resolvePreset } from './presets/index.js'

export function policyHost(ctx: Context, deps: { selectModel: (request: { sessionId: string; provider: string; model: string; reasoningEffort: string }) => Promise<unknown>; feedback: FeedbackBook; jev: JevClient; state: RoutingState; store: PolicyStore; settings: () => Settings; catalog: (provider?: string) => Promise<RoutingCatalog>; registry?: Registry }) {
  const registry = deps.registry ?? builtin
  const familyOf = (model: string) => registry.familyOfMainModel(model)?.id
  const delegation = new AsyncLocalStorage<{ parentId: string; rootId: string; path: ChildDecision['path']; explicit: { provider?: string; model?: string; reasoningEffort?: string }; prompt: string }>()
  const rootOf = (agent: Agent): Agent | undefined => {
    let current: Agent | undefined = agent
    for (let i = 0; current && i < 32; i++) {
      if (current.session.header.origin !== 'subagent') return current
      current = current.session.header.parentSession ? ctx.agents.get(current.session.header.parentSession) : undefined
    }
  }
  const epochs = new Map<string, number>()
  const epoch = (id: string) => epochs.get(id) ?? 0
  const enabled = (rootId: string) => deps.state.read(rootId).mode === 'AUTO'
  const pending = new Map<string, ChildDecision>()
  const main = new WeakMap<Agent, { turn: number; depth: Depth; active: boolean; epoch: number }>()
  ctx.effect(() => () => { pending.clear(); delegation.disable() })
  /** In-memory decision view: the persisted child record shape plus the preset that made the judgement (never persisted in child records). */
  type Decision = NonNullable<ChildDecision['decision']> & { preset?: string }
  const mainStatus = new Map<string, { depth: Depth; effort?: string; reason: string; decision?: Decision }>()
  let decisionId = Date.now()
  const requestMetadata = new Map<string, { requestSeq: number; appliedAt: number; requestTurn?: number }>()
  /** Each main session's current decision: time and the preset captured for it. Lives until replaced, voided or disposed — never evicted by other sessions' traffic. */
  const mainDecided = new Map<string, { id: number; decidedAt: number; preset: string }>()
  const applied = new Map<string, Decision>()
  const latest = new Map<string, Decision>()
  /** Preset captured at each managed child's judgement, keyed by child id (memory only). */
  const childPreset = new Map<string, string>()
  /** Fall back to MANUAL when the main model left AUTO's registered families. */
  const lockUnsupportedMain = (agent: Agent) => {
    deps.state.setMode(agent.id, 'MANUAL')
    mainStatus.delete(agent.id)
    latest.delete(agent.id)
    applied.delete(agent.id)
  }
  const childEpochs = new Map<string, number>()
  const notices = new Map<string, { id: number; childId: string; reason: string; at: number }>()
  let noticeId = 0
  /** Visible fallback: the child request runs with DSH defaults, the root learns why. */
  const fallback = (record: ChildDecision, reason: string): ChildDecision => {
    const next: ChildDecision = { childId: record.childId, parentId: record.parentId, rootId: record.rootId, path: record.path, explicit: record.explicit,
      ...(record.family ? { family: record.family } : {}), ...(record.parentSelection ? { parentSelection: record.parentSelection } : {}), status: 'unsupported', reason }
    deps.store.set(next)
    pending.delete(record.childId)
    childEpochs.delete(record.childId)
    notices.set(record.rootId, { id: ++noticeId, childId: record.childId, reason, at: Date.now() })
    ctx.logger.warn(`auto-model-routing: child ${record.childId} not routed (${reason}); running with DSH defaults`)
    return next
  }
  const capturedAllowlist = (parentId: string) => {
    const events: readonly { type: string; data: unknown }[] = ctx.agents.get(SessionId(parentId))?.session.snapshotEvents() ?? []
    const captured = events.find(event => event.type === 'subagent/model-selection-policy')
    if (!captured) return undefined
    const allowed = (captured.data as { allowedModels?: unknown }).allowedModels
    return Array.isArray(allowed) ? allowed as { provider: string; model: string }[] : []
  }
  ctx.on('tools/execute', async (exec, next) => {
    if (!['subagent','spawn_teammate'].includes(exec.name) || !exec.agent) return next()
    const args = isRecord(exec.arguments) ? exec.arguments : {}
    // Fork copies the parent: AUTO does not manage it and opens no binding window.
    if (exec.name === 'spawn_teammate' && args.context === 'fork') return next()
    const root = rootOf(exec.agent)
    if (!root || !enabled(root.id)) return next()
    const explicit = { ...(typeof args.provider === 'string' && args.provider ? { provider: args.provider } : {}),
      ...(typeof args.model === 'string' ? { model: args.model } : {}),
      ...(typeof args.reasoning_effort === 'string' ? { reasoningEffort: args.reasoning_effort } : {}) }
    // The official tools' task text is `args.prompt`: the child's first user message, and the only input of its judgement.
    return delegation.run({ parentId: exec.agent.id, rootId: root.id, path: exec.name === 'spawn_teammate' ? 'teammate' : 'ordinary', explicit, prompt: typeof args.prompt === 'string' ? args.prompt : '' }, next)
  })
  /**
   * Managed child, `agent/created` (startup): bind, sample the parent, judge (awaited with the creation signal, before the first
   * message is delivered) and write the route into the child's own selection. DSH 0.2.2 fixes each step's selection at the start of the
   * step, so the route must already be the child's selection by then; nothing is saved as a global default.
   */
  const routeChild = async (agent: Agent, initial: ChildDecision, prompt: string, signal: AbortSignal) => {
    let record = initial
    const startedEpoch = childEpochs.get(agent.id) ?? epoch(record.rootId)
    const current = () => enabled(record.rootId) && epoch(record.rootId) === startedEpoch
    if (!current()) { fallback(record, 'mode-changed'); return }
    const explicit = record.explicit
    let measure: PolicyMeasure | undefined
    let capability: 'bounded' | 'analytical' | 'frontier' = 'bounded', depth: Depth = 'baseline'
    if (!explicit.model || !explicit.reasoningEffort) {
      // The exact child's first user message (the official tool's `prompt`), not a parent-history/prompt similarity match.
      const text = redact(prompt).slice(0, 8000)
      // Captured when this judgement starts.
      const preset = resolvePreset(deps.settings().preset)
      childPreset.set(agent.id, preset.id)
      const result = await deps.jev.judgePolicy(buildState({ text, execution: preset.context.includes('execution') ? 'delegated' : undefined }), signal, 'child', explicit.model ? 'depth' : explicit.reasoningEffort ? 'capability' : 'both', preset)
      if (!current()) { fallback(record, 'mode-changed'); return }
      if (result.kind === 'cancelled' || signal.aborted) { fallback(record, 'jev-cancelled'); return }
      if (result.kind === 'failed') { fallback(record, `jev-${result.category}`); return }
      if (result.capability === 'insufficient_context') { fallback(record, 'needs-context'); return }
      measure = result
      capability = result.capability ?? 'bounded'; depth = result.depth
    }
    const catalog = await deps.catalog(explicit.provider)
    if (!current()) { fallback(record, 'mode-changed'); return }
    if (signal.aborted) { fallback(record, 'jev-cancelled'); return }
    const parent = record.parentSelection ?? { provider: explicit.provider }
    const chosen = chooseChildRoute({ provider: explicit.provider, parent, explicit, capability, depth, catalog, cap: deps.settings().effortCap, captured: capturedAllowlist(record.parentId) }, registry)
    if ('fallback' in chosen) { fallback(record, chosen.fallback); return }
    const route = chosen.route
    record = { ...record, route, status: 'recommended', decision: { id: ++decisionId, source: 'subagent', tier: capability, depth, capability, effort: route.reasoningEffort, model: route.model, provider: route.provider, status: 'recommended', ms: measure?.ms ?? 0, decisionProvider: measure?.decisionProvider ?? 'explicit', decisionModel: measure?.decisionModel ?? '未调用', ...(measure?.confidence !== undefined ? { confidence: measure.confidence } : {}), ...(measure?.capabilityConfidence !== undefined ? { capabilityConfidence: measure.capabilityConfidence } : {}), ...(measure?.probabilities ? { probabilities: measure.probabilities } : {}), ...(measure?.capabilityProbabilities ? { capabilityProbabilities: measure.capabilityProbabilities } : {}) } }
    deps.store.set(record); pending.delete(agent.id); childEpochs.delete(agent.id)
    // The child's own selection (durable `model/selection`), never the session-controller path: no global default is written.
    agent.model.select(route as Parameters<typeof agent.model.select>[0])
  }
  /** Resume of a legacy-recorded route: 0.2.1 only rewrote the route per request, so a child interrupted before its first request resumes at the parent snapshot. */
  const restoreRoute = (agent: Agent) => {
    let record: ChildDecision | undefined
    // Missing, corrupt or mismatched records are left to the request gate, which fails closed on every attempt.
    try { record = deps.store.get(agent.id) } catch { return }
    if (!record?.route || record.status === 'failed' || record.parentId !== agent.session.header.parentSession) return
    const selected = agent.model.current()
    const route = record.route
    if (selected && selected.provider === route.provider && selected.model === route.model && selected.reasoningEffort === route.reasoningEffort) return
    agent.model.select(route as Parameters<typeof agent.model.select>[0])
  }
  ctx.on('agent/created', async ({ agent, source, signal }) => {
    if (agent.session.header.origin !== 'subagent') return
    if (source === 'resume') { restoreRoute(agent); return }
    if (source !== 'startup') return
    const binding = delegation.getStore()
    // shortcut: same-window plugin children under this parent are indistinguishable (accepted 2026-10-28), until DSH exposes tool-call→child identity.
    if (!binding || binding.parentId !== agent.session.header.parentSession || !enabled(binding.rootId) || deps.store.wasBound(agent.id)) return
    const parent = ctx.agents.get(SessionId(binding.parentId))
    if (!parent) return
    const config = parent.session.requestHeader()?.config
    const provider = config?.provider ?? parent.options.provider
    const model = config?.model ?? parent.options.model
    const effort = config?.reasoningEffort ?? parent.options.reasoningEffort
    const routeProvider = binding.explicit.provider ?? provider
    if (typeof provider !== 'string' || !provider || typeof routeProvider !== 'string' || !routeProvider) return
    const family = registry.familyOfMainModel(binding.explicit.model ?? (typeof model === 'string' ? model : undefined))?.id
    const record: ChildDecision = { childId: agent.id, parentId: binding.parentId, rootId: binding.rootId, path: binding.path, status: 'recommended',
      explicit: { ...binding.explicit, provider: routeProvider }, ...(family ? { family } : {}),
      parentSelection: { provider, ...(typeof model === 'string' ? { model } : {}), ...(typeof effort === 'string' ? { reasoningEffort: effort } : {}) } }
    deps.store.create(record)
    pending.set(agent.id, record)
    childEpochs.set(agent.id, epoch(binding.rootId))
    await routeChild(agent, record, binding.prompt, signal ?? new AbortController().signal)
  })
  const requireBindingRecord = (agent: Agent, record: ChildDecision | undefined) => {
    if (deps.store.wasBound(agent.id) && !record) throw new Error('已绑定子会话的决策记录缺失，无法恢复；停止请求，不恢复继承配置')
  }
  ctx.on('agent/disposed', ({ agent }) => { pending.delete(agent.id); childPreset.delete(agent.id); mainStatus.delete(agent.id); mainDecided.delete(agent.id); return undefined })
  /**
   * Main session, every step: compute the step's effort and apply it before the request is prepared.
   * DSH 0.2.2 pins `model.current()` at the start of each pre-step and fails any `agent/request` result that differs from it,
   * so the effort is synced to the official selection first and then written into the step's pinned selection (the object
   * the request is prepared from; see spec「本步选择改写依赖运行体核验」). Only the effort is touched, never provider/model.
   */
  const applyMainEffort = async (payload: Parameters<Parameters<typeof ctx.on<'agent/pre-step'>>[1]>[0]) => {
    const agent = payload.agent
    const runtime = main.get(agent)
    if (!runtime?.active || runtime.turn !== payload.turn || runtime.epoch !== epoch(agent.id) || !enabled(agent.id)) return
    const selection = payload.modelSelection
    // Authoritative gate: the step's actual model decides, whatever the picker showed earlier.
    if (!autoSupportedModel(selection.model, registry)) { lockUnsupportedMain(agent); return }
    const unsupported = (effort = '模型不支持调整') => {
      const old = mainStatus.get(agent.id)
      mainStatus.set(agent.id, { ...old, depth: runtime.depth, reason: 'no-effort-support', ...(old?.decision ? { decision: { ...old.decision, status: 'unsupported', model: selection.model, provider: selection.provider, effort } } : {}) })
    }
    const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model, payload.signal)
    if (!enabled(agent.id) || runtime.epoch !== epoch(agent.id) || payload.signal.aborted) return
    const efforts = (info.reasoning?.efforts ?? []).map(e => String(e.id))
    if (!efforts.length) { unsupported(); return }
    let reasoningEffort: AutomaticEffort
    try {
      reasoningEffort = policyEffort(selection.model, runtime.depth, efforts, deps.settings().effortCap, info.reasoning?.defaultEffort ? String(info.reasoning.defaultEffort) : undefined, registry)
    } catch (error) {
      // A supported model whose directory cannot produce an automatic effort must not fail the turn.
      ctx.logger.warn(`auto-model-routing: could not map the main reasoning effort: ${String(error)}`)
      unsupported()
      return
    }
    mainStatus.set(agent.id, { ...mainStatus.get(agent.id), depth: runtime.depth, effort: reasoningEffort, reason: 'jev', ...(mainStatus.get(agent.id)?.decision ? { decision: { ...mainStatus.get(agent.id)!.decision!, effort: reasoningEffort, model: selection.model, provider: selection.provider } } : {}) })
    if (reasoningEffort === selection.reasoningEffort) return
    try { await deps.selectModel({ sessionId: agent.id, provider: selection.provider, model: selection.model, reasoningEffort }) }
    catch (error) { ctx.logger.warn(`auto-model-routing: could not sync the model selection: ${String(error)}`); return }
    // The user may have left AUTO while the official selection was being written: then the step keeps its pinned selection.
    if (!enabled(agent.id) || runtime.epoch !== epoch(agent.id) || payload.signal.aborted) return
    try { (selection as { reasoningEffort?: string }).reasoningEffort = reasoningEffort }
    catch (error) {
      // A frozen selection: the official selection already carries the value, so it takes effect from the next step.
      ctx.logger.warn(`auto-model-routing: could not apply the effort to this step's pinned selection (takes effect next step): ${String(error)}`)
    }
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    const agent = payload.agent
    if (agent.session.header.origin === 'subagent') return decision
    if (!enabled(agent.id)) return decision
    if (payload.step === 1) {
      const input = userInput(decision.messages)
      const old = main.get(agent)
      if (input.userTurn) {
        // The main model left AUTO's registered families: judge nothing, rewrite nothing.
        if (!mainSupported(currentMainSelection(ctx, agent), registry)) { lockUnsupportedMain(agent); return decision }
        applied.delete(agent.id)
        mainStatus.delete(agent.id)
        const startedEpoch = epoch(agent.id)
        const prior = previousTurn(agent.session.deriveMessages())
        // Captured once: state, questions, choice checks and attribution all use this preset.
        const preset = resolvePreset(deps.settings().preset)
        const result = await deps.jev.judgePolicy(buildState({ text: input.text, prevUser: prior.user, prevAssistant: prior.assistant, execution: preset.context.includes('execution') ? 'main' : undefined }), payload.signal, 'main', 'depth', preset)
        if (!enabled(agent.id) || epoch(agent.id) !== startedEpoch) return decision
        if (result.kind === 'failed') { mainDecided.delete(agent.id); deps.state.disable(agent.id, result.category); mainStatus.delete(agent.id); latest.delete(agent.id); main.set(agent, { turn: payload.turn, depth: 'baseline', active: false, epoch: startedEpoch }); return decision }
        if (result.kind === 'cancelled') { mainDecided.delete(agent.id); main.set(agent, { turn: payload.turn, depth: 'baseline', active: false, epoch: startedEpoch }); return decision }
        main.set(agent, { turn: payload.turn, depth: result.depth, active: true, epoch: startedEpoch })
        const { kind: _kind, ...measurement } = result
        latest.delete(agent.id)
        mainStatus.set(agent.id, { depth: result.depth, reason: 'jev', decision: { ...measurement, id: ++decisionId, source: 'main', tier: result.depth, effort: '待应用', status: 'recommended', preset: preset.id } })
        mainDecided.set(agent.id, { id: decisionId, decidedAt: Date.now(), preset: preset.id })
        if (mainStatus.size > 200) mainStatus.delete(mainStatus.keys().next().value!)
      } else if (old) main.set(agent, { ...old, turn: payload.turn })
    }
    await applyMainEffort(payload)
    return decision
  })
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const agent = payload.agent
    // Main sessions are handled in the pre-step (DSH 0.2.2 rejects a request config that differs from the step's pinned selection).
    if (agent.session.header.origin !== 'subagent') return config
    // Managed children: the route was written into the child's own selection at `agent/created`; this listener only verifies it,
    // on every attempt (retries included), and returns the request unchanged.
    const record = deps.store.get(agent.id)
    requireBindingRecord(agent, record)
    if (record && record.parentId !== agent.session.header.parentSession) throw new Error('决策身份不匹配')
    if (record && !record.route && record.status === 'recommended' && !pending.has(agent.id)) { fallback(record, 'interrupted'); return config }
    if (!record?.route) return config
    if (record.status === 'failed') throw new Error('实际应用失败；暂停子请求并询问用户')
    // Existing routed instances keep their initial route; live gates are re-checked on every request.
    validatePolicyRoute(await deps.catalog(record.route.provider), record.route.provider, record.route.model, record.route.reasoningEffort, deps.settings().effortCap, capturedAllowlist(record.parentId))
    if (config.provider !== record.route.provider || config.model !== record.route.model || config.reasoningEffort !== record.route.reasoningEffort) {
      const preset = childPreset.get(agent.id)
      if (record.decision) latest.set(record.rootId, { ...record.decision, status: 'failed', ...(preset && record.decision.decisionProvider !== 'explicit' ? { preset } : {}) })
      deps.store.set({ ...record, ...(record.decision ? { decision: { ...record.decision, status: 'failed' } } : {}), status: 'failed', reason: '实际请求配置不匹配' })
      throw new Error('实际请求配置不匹配')
    }
    return config
  }, { prepend: true })
  const confirmMainRequest = (session: Session, requestSeq: number, turn?: number) => {
    const status = mainStatus.get(session.id)
    const actual = session.requestHeader()?.config
    if (!enabled(session.id) || !status?.decision || !actual) return
    const d = { ...status.decision, status: status.decision.status === 'unsupported' ? 'unsupported' : actual.reasoningEffort === status.effort && actual.provider === status.decision.provider && actual.model === status.decision.model ? 'applied' : 'failed', ...(actual.model ? { model: actual.model } : {}), ...(actual.provider ? { provider: actual.provider } : {}) }
    mainStatus.set(session.id, { ...status, decision: d }); latest.set(session.id, d)
    if (d.status === 'applied') {
      applied.set(session.id, d)
      requestMetadata.set(session.id, { requestSeq, appliedAt: Date.now(), ...(turn !== undefined ? { requestTurn: turn } : {}) })
    } else applied.delete(session.id)
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message') {
      // Unchanged requests reuse the durable header and emit no request/header event.
      if (!applied.has(session.id) && mainStatus.get(session.id)?.decision?.status === 'recommended') {
        const header = session.snapshotEvents().findLast(e => e.type === 'request/header')
        if (header) confirmMainRequest(session, header.seq, event.data.turn)
      }
      const d = applied.get(session.id)
      const data = event.data as { message?: { id?: string } }
      if (d?.status === 'applied' && enabled(session.id) && data.message?.id && d.model) {
        try { deps.feedback.bind({ sessionId: session.id, messageId: data.message.id, decisionId: d.id, depth: d.depth, model: d.model, effort: d.effort,
          ...(requestMetadata.has(session.id) && d.provider && mainDecided.get(session.id)?.id === d.id ? { snapshot: {
            ...requestMetadata.get(session.id)!, decidedAt: mainDecided.get(session.id)!.decidedAt, preset: mainDecided.get(session.id)!.preset, ...(familyOf(d.model) ? { strategy: familyOf(d.model)! } : {}),
            decisionProvider: d.decisionProvider, decisionModel: d.decisionModel, ms: d.ms, provider: d.provider,
            ...(d.confidence !== undefined ? { confidence: d.confidence } : {}), ...(d.probabilities ? { probabilities: d.probabilities } : {}),
          } } : {}),
        }) }
        catch { ctx.logger.warn('auto-model-routing: could not bind allocation feedback') }
      }
      return
    }
    if (event.type !== 'request/header') return
    applied.delete(session.id)
    requestMetadata.delete(session.id)
    const record = deps.store.get(session.id)
    if (!record?.route) {
      confirmMainRequest(session, event.seq, (event.data as { turn?: number }).turn)
      return
    }
    const actual = (event.data as { header?: { config?: { provider?: string; model?: string; reasoningEffort?: string } } }).header?.config
    if (!actual) return
    const matches = actual.provider === record.route.provider && actual.model === record.route.model && actual.reasoningEffort === record.route.reasoningEffort
    const preset = childPreset.get(session.id)
    if (record.decision) latest.set(record.rootId, { ...record.decision, status: matches ? 'applied' : 'failed', ...(preset && record.decision.decisionProvider !== 'explicit' ? { preset } : {}) })
    deps.store.set({ ...record, ...(record.decision ? { decision: { ...record.decision, status: matches ? 'applied' : 'failed' } } : {}), status: matches ? 'applied' : 'failed', ...(matches ? { actual: record.route } : { reason: '实际请求配置不匹配' }) })
    if (!matches) throw new Error('实际请求配置不匹配')
  })
  return {
    appliedDecision: (id: string) => enabled(id) ? applied.get(id)?.id : undefined,
    invalidate: (id: string) => { epochs.set(id, epoch(id) + 1); mainStatus.delete(id); latest.delete(id); applied.delete(id); mainDecided.delete(id) },
    childNotice: (rootId: string) => notices.get(rootId),
    status: (id: string) => deps.store.get(id), mainStatus: (id: string) => enabled(id) ? { ...mainStatus.get(id), ...(latest.get(id) ? { decision: latest.get(id) } : {}) } : undefined,
  }
}
