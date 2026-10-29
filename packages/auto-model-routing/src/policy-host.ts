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
import { buildState, previousTurn } from './context.js'
import { isRecord } from './settings-validation.js'
import { autoSupportedModel, currentMainSelection, mainSupported } from './support.js'

export function policyHost(ctx: Context, deps: { selectModel: (request: { sessionId: string; provider: string; model: string; reasoningEffort: string }) => Promise<unknown>; feedback: FeedbackBook; jev: JevClient; state: RoutingState; store: PolicyStore; settings: () => Settings; catalog: (provider?: string) => Promise<RoutingCatalog>; registry?: Registry }) {
  const registry = deps.registry ?? builtin
  const familyOf = (model: string) => registry.familyOfMainModel(model)?.id
  const delegation = new AsyncLocalStorage<{ parentId: string; rootId: string; path: ChildDecision['path']; explicit: { provider?: string; model?: string; reasoningEffort?: string } }>()
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
  const mainStatus = new Map<string, { depth: Depth; effort?: string; reason: string; decision?: NonNullable<ChildDecision['decision']> }>()
  let decisionId = Date.now()
  const requestMetadata = new Map<string, { requestSeq: number; appliedAt: number; requestTurn?: number }>()
  const decidedAt = new Map<number, number>()
  const applied = new Map<string, NonNullable<ChildDecision['decision']>>()
  const latest = new Map<string, NonNullable<ChildDecision['decision']>>()
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
    return delegation.run({ parentId: exec.agent.id, rootId: root.id, path: exec.name === 'spawn_teammate' ? 'teammate' : 'ordinary', explicit }, next)
  })
  ctx.on('agent/created', ({ agent, source }) => {
    if (agent.session.header.origin !== 'subagent' || source !== 'startup') return
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
    return undefined
  })
  const requireBindingRecord = (agent: Agent, record: ChildDecision | undefined) => {
    if (deps.store.wasBound(agent.id) && !record) throw new Error('已绑定子会话的决策记录缺失，无法恢复；停止请求，不恢复继承配置')
  }
  ctx.on('agent/disposed', ({ agent }) => { pending.delete(agent.id); mainStatus.delete(agent.id); return undefined })
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || payload.step !== 1) return decision
    const agent = payload.agent
    if (agent.session.header.origin !== 'subagent') {
      if (!enabled(agent.id)) return decision
      const input = userInput(decision.messages)
      const old = main.get(agent)
      if (!input.userTurn) { if (old) main.set(agent, { ...old, turn: payload.turn }); return decision }
      // The main model left AUTO's registered families: judge nothing, rewrite nothing.
      if (!mainSupported(currentMainSelection(ctx, agent), registry)) { lockUnsupportedMain(agent); return decision }
      applied.delete(agent.id)
      mainStatus.delete(agent.id)
      const startedEpoch = epoch(agent.id)
      const prior = previousTurn(agent.session.deriveMessages())
      const result = await deps.jev.judgePolicy(buildState({ text: input.text, prevUser: prior.user, prevAssistant: prior.assistant }), payload.signal, 'main')
      if (!enabled(agent.id) || epoch(agent.id) !== startedEpoch) return decision
      if (result.kind === 'failed') { deps.state.disable(agent.id, result.category); mainStatus.delete(agent.id); latest.delete(agent.id); main.set(agent, { turn: payload.turn, depth: 'baseline', active: false, epoch: startedEpoch }); return decision }
      if (result.kind === 'cancelled') { main.set(agent, { turn: payload.turn, depth: 'baseline', active: false, epoch: startedEpoch }); return decision }
      main.set(agent, { turn: payload.turn, depth: result.depth, active: true, epoch: startedEpoch })
      const { kind: _kind, ...measurement } = result
      latest.delete(agent.id)
      mainStatus.set(agent.id, { depth: result.depth, reason: 'jev', decision: { ...measurement, id: ++decisionId, source: 'main', tier: result.depth, effort: '待应用', status: 'recommended' } })
      decidedAt.set(decisionId, Date.now())
      if (decidedAt.size > 200) decidedAt.delete(decidedAt.keys().next().value!)
      if (mainStatus.size > 200) mainStatus.delete(mainStatus.keys().next().value!)
      return decision
    }
    let record = pending.get(agent.id) ?? deps.store.get(agent.id)
    requireBindingRecord(agent, record)
    // Unbound children (plugin-created, MANUAL-created, fork) pass through untouched.
    if (!record) return decision
    if (record.parentId !== agent.session.header.parentSession) throw new Error('子会话身份不匹配')
    if (record.route || record.status !== 'recommended') return decision
    if (!pending.has(agent.id)) { fallback(record, 'interrupted'); return decision }
    const startedEpoch = childEpochs.get(agent.id) ?? epoch(record.rootId)
    const current = () => enabled(record!.rootId) && epoch(record!.rootId) === startedEpoch
    if (!current()) { fallback(record, 'mode-changed'); return decision }
    const explicit = record.explicit
    let measure: PolicyMeasure | undefined
    let capability: 'bounded' | 'analytical' | 'frontier' = 'bounded', depth: Depth = 'baseline'
    if (!explicit.model || !explicit.reasoningEffort) {
      // This is the exact child's entering message, not a parent-history/prompt similarity match.
      const text = userInput(decision.messages).text
      const result = await deps.jev.judgePolicy(buildState({ text }), payload.signal, 'child', explicit.model ? 'depth' : explicit.reasoningEffort ? 'capability' : 'both')
      if (!current()) { fallback(record, 'mode-changed'); return decision }
      if (result.kind === 'cancelled') { fallback(record, 'jev-cancelled'); return decision }
      if (result.kind === 'failed') { fallback(record, `jev-${result.category}`); return decision }
      if (result.capability === 'insufficient_context') { fallback(record, 'needs-context'); return decision }
      measure = result
      capability = result.capability ?? 'bounded'; depth = result.depth
    }
    const catalog = await deps.catalog(explicit.provider)
    if (!current()) { fallback(record, 'mode-changed'); return decision }
    const parent = record.parentSelection ?? { provider: explicit.provider }
    const chosen = chooseChildRoute({ provider: explicit.provider, parent, explicit, capability, depth, catalog, cap: deps.settings().effortCap, captured: capturedAllowlist(record.parentId) }, registry)
    if ('fallback' in chosen) { fallback(record, chosen.fallback); return decision }
    const route = chosen.route
    record = { ...record, route, status: 'recommended', decision: { id: ++decisionId, source: 'subagent', tier: capability, depth, capability, effort: route.reasoningEffort, model: route.model, provider: route.provider, status: 'recommended', ms: measure?.ms ?? 0, decisionProvider: measure?.decisionProvider ?? 'explicit', decisionModel: measure?.decisionModel ?? '未调用', ...(measure?.confidence !== undefined ? { confidence: measure.confidence } : {}), ...(measure?.capabilityConfidence !== undefined ? { capabilityConfidence: measure.capabilityConfidence } : {}), ...(measure?.probabilities ? { probabilities: measure.probabilities } : {}), ...(measure?.capabilityProbabilities ? { capabilityProbabilities: measure.capabilityProbabilities } : {}) } }
    deps.store.set(record); pending.delete(agent.id); childEpochs.delete(agent.id)
    return decision
  })
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const agent = payload.agent
    if (agent.session.header.origin !== 'subagent') {
      const runtime = main.get(agent)
      if (!runtime?.active || runtime.turn !== payload.turn || runtime.epoch !== epoch(agent.id) || !enabled(agent.id)) return config
      // Authoritative gate: the request's actual model decides, whatever the picker showed earlier.
      if (!autoSupportedModel(config.model, registry)) { lockUnsupportedMain(agent); return config }
      const unsupported = (effort = '模型不支持调整') => {
        const old = mainStatus.get(agent.id)
        mainStatus.set(agent.id, { ...old, depth: runtime.depth, reason: 'no-effort-support', ...(old?.decision ? { decision: { ...old.decision, status: 'unsupported', model: config.model, provider: config.provider, effort } } : {}) })
      }
      const info = await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal)
      if (!enabled(agent.id) || runtime.epoch !== epoch(agent.id) || payload.signal.aborted) return config
      const efforts = (info.reasoning?.efforts ?? []).map(e => String(e.id))
      if (!efforts.length) { unsupported(); return config }
      let reasoningEffort: AutomaticEffort
      try {
        reasoningEffort = policyEffort(config.model, runtime.depth, efforts, deps.settings().effortCap, info.reasoning?.defaultEffort ? String(info.reasoning.defaultEffort) : undefined, registry)
      } catch (error) {
        // A supported model whose directory cannot produce an automatic effort must not fail the turn.
        ctx.logger.warn(`auto-model-routing: could not map the main reasoning effort: ${String(error)}`)
        unsupported()
        return config
      }
      mainStatus.set(agent.id, { ...mainStatus.get(agent.id), depth: runtime.depth, effort: reasoningEffort, reason: 'jev', ...(mainStatus.get(agent.id)?.decision ? { decision: { ...mainStatus.get(agent.id)!.decision!, effort: reasoningEffort, model: config.model, provider: config.provider } } : {}) })
      if (reasoningEffort !== config.reasoningEffort) {
        try { await deps.selectModel({ sessionId: agent.id, provider: config.provider, model: config.model, reasoningEffort }) }
        catch (error) { ctx.logger.warn(`auto-model-routing: could not sync the model selection: ${String(error)}`); return config }
      }
      return { ...config, reasoningEffort } as typeof config
    }
    const record = deps.store.get(agent.id)
    requireBindingRecord(agent, record)
    if (!record?.route) return config
    if (record.status === 'failed') throw new Error('实际应用失败；暂停子请求并询问用户')
    if (record.parentId !== agent.session.header.parentSession) throw new Error('决策身份不匹配')
    // Existing routed instances keep their initial route; live gates are re-checked on every request.
    validatePolicyRoute(await deps.catalog(record.route.provider), record.route.provider, record.route.model, record.route.reasoningEffort, deps.settings().effortCap, capturedAllowlist(record.parentId))
    return { ...config, ...record.route } as typeof config
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
          ...(requestMetadata.has(session.id) && d.provider && decidedAt.has(d.id) ? { snapshot: {
            ...requestMetadata.get(session.id)!, decidedAt: decidedAt.get(d.id)!, ...(familyOf(d.model) ? { strategy: familyOf(d.model)! } : {}),
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
    if (record.decision) latest.set(record.rootId, { ...record.decision, status: matches ? 'applied' : 'failed' })
    deps.store.set({ ...record, ...(record.decision ? { decision: { ...record.decision, status: matches ? 'applied' : 'failed' } } : {}), status: matches ? 'applied' : 'failed', ...(matches ? { actual: record.route } : { reason: '实际请求配置不匹配' }) })
    if (!matches) throw new Error('实际请求配置不匹配')
  })
  return {
    appliedDecision: (id: string) => enabled(id) ? applied.get(id)?.id : undefined,
    invalidate: (id: string) => { epochs.set(id, epoch(id) + 1); mainStatus.delete(id); latest.delete(id); applied.delete(id) },
    childNotice: (rootId: string) => notices.get(rootId),
    status: (id: string) => deps.store.get(id), mainStatus: (id: string) => enabled(id) ? { ...mainStatus.get(id), ...(latest.get(id) ? { decision: latest.get(id) } : {}) } : undefined,
  }
}
