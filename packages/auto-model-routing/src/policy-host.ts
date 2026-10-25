import type { FeedbackBook } from './feedback.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { JevClient, Depth, PolicyMeasure } from './jev.js'
import { policyVersion, CATEGORY_HINTS } from './jev.js'
import { choosePolicyRoute, mappingVersion, policyEffort, modelFamily, policyProvider, validatePolicyRoute } from './policy-v2.js'
import { PolicyStore, type ChildDecision } from './policy-store.js'
import type { RoutingState } from './state.js'
import type { RoutingCatalog, Settings } from './settings-contract.js'
import { userInput } from './input.js'
import { buildState, previousTurn } from './context.js'
import { isRecord } from './settings-validation.js'

export function policyHost(ctx: Context, deps: { feedback: FeedbackBook; jev: JevClient; state: RoutingState; store: PolicyStore; settings: () => Settings; catalog: () => Promise<RoutingCatalog> }) {
  const delegation = new AsyncLocalStorage<{ parentId: string; rootId: string; path: ChildDecision['path']; explicit: ChildDecision['explicit']; family?: 'claude' | 'codex' }>()
  const rootOf = (agent: Agent): Agent | undefined => {
    let current: Agent | undefined = agent
    for (let i = 0; current && i < 32; i++) {
      if (current.session.header.origin !== 'subagent') return current
      current = current.session.header.parentSession ? ctx.agents.get(current.session.header.parentSession) : undefined
    }
  }
  const epochs = new Map<string, number>()
  const epoch = (id: string) => epochs.get(id) ?? 0
  const enabled = (rootId: string) => deps.settings().policy === 'policy-v2' && deps.state.read(rootId).mode === 'AUTO'
  const pending = new Map<string, ChildDecision>()
  const main = new WeakMap<Agent, { turn: number; depth: Depth; active: boolean; epoch: number }>()
  ctx.effect(() => () => { pending.clear(); delegation.disable() })
  const mainStatus = new Map<string, { policyVersion: string; depth: Depth; effort?: string; reason: string; decision?: NonNullable<ChildDecision['decision']> }>()
  let decisionId = Date.now()
  const requestMetadata = new Map<string, { requestSeq: number; appliedAt: number; requestTurn?: number }>()
  const decidedAt = new Map<number, number>()
  const applied = new Map<string, NonNullable<ChildDecision['decision']>>()
  const latest = new Map<string, NonNullable<ChildDecision['decision']>>()
  ctx.on('tools/execute', async (exec, next) => {
    if (!['subagent','subagent_fork','spawn_teammate'].includes(exec.name) || !exec.agent) return next()
    const root = rootOf(exec.agent)
    if (!root || !enabled(root.id)) return next()
    const args = isRecord(exec.arguments) ? exec.arguments : {}
    const path = exec.name === 'subagent_fork' || (exec.name === 'spawn_teammate' && args.context === 'fork') ? 'fork' : exec.name === 'spawn_teammate' ? 'teammate' : 'ordinary'
    if (path === 'fork') throw new Error('policy-v2 unsupported：fork 的真实历史兼容尚未验证；请暂停，改用 fresh 或由用户选择关闭试验策略后继承。')
    const provider = args.provider ?? exec.agent.session.requestHeader()?.config.provider ?? exec.agent.options.provider
    if (typeof provider !== 'string' || !policyProvider(provider)) throw new Error('policy-v2 unsupported：无法验证 provider；暂停委派并询问用户')
    const parentModel = exec.agent.session.requestHeader()?.config.model ?? exec.agent.options.model
    const family = modelFamily(provider, typeof args.model === 'string' ? args.model : parentModel ?? '')
    const explicit: ChildDecision['explicit'] = { provider,
      ...(typeof args.model === 'string' ? { model: args.model } : {}),
      ...(typeof args.reasoning_effort === 'string' ? { reasoningEffort: args.reasoning_effort } : {}) }
    return delegation.run({ parentId: exec.agent.id, rootId: root.id, path, explicit, ...(family ? { family } : {}) }, next)
  })
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent') return
    const binding = delegation.getStore()
    if (!binding || binding.parentId !== agent.session.header.parentSession) return
    // Creation is precisely inside this official tool's async lifetime, never matched by prompt.
    const record: ChildDecision = { version: 1, childId: agent.id, ...binding, policyVersion, mappingVersion, status: 'recommended' }
    deps.store.set(record)
    deps.store.bind(agent.id)
    pending.set(agent.id, record)
    return undefined
  })
  const requireBindingRecord = (agent: Agent, record: ChildDecision | undefined) => {
    if (deps.store.wasBound(agent.id) && !record) throw new Error('policy-v2 已绑定子会话的决策记录缺失；停止请求，不恢复继承配置')
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
      mainStatus.set(agent.id, { policyVersion, depth: result.depth, reason: 'jev', decision: { ...measurement, id: ++decisionId, source: 'main', tier: result.depth, effort: '待应用', status: 'recommended' } })
      decidedAt.set(decisionId, Date.now())
      if (decidedAt.size > 200) decidedAt.delete(decidedAt.keys().next().value!)
      if (mainStatus.size > 200) mainStatus.delete(mainStatus.keys().next().value!)
      return decision
    }
    let record = pending.get(agent.id) ?? deps.store.get(agent.id)
    requireBindingRecord(agent, record)
    if (!record) {
      const root = rootOf(agent)
      if (root && enabled(root.id)) throw new Error('policy-v2 unsupported：创建没有官方工具身份绑定；该子请求未路由。请暂停并选择受支持创建路径或关闭试验后继承。')
      return decision
    }
    if (record.parentId !== agent.session.header.parentSession) throw new Error('policy-v2 子会话身份不匹配')
    if (!record.route && !enabled(record.rootId)) { pending.delete(agent.id); throw new Error('policy-v2 创建期间策略或模式已改变；请重新创建，不静默继承') }
    if (!record.route && enabled(record.rootId)) {
      if (!pending.has(agent.id)) throw new Error('policy-v2 初始决策未完成且已恢复；不能用后续消息重新选模，请发起新资源决策')
      if (record.status !== 'recommended') throw new Error(`policy-v2 ${record.status}：${record.reason ?? '初始决策未完成'}；暂停并询问用户`)
      const saveFailure = (status: ChildDecision['status'], reason: string) => { record = { ...record!, status, reason }; deps.store.set(record); pending.delete(agent.id) }
      if (record.policyVersion !== policyVersion || record.mappingVersion !== mappingVersion) throw new Error('policy-v2 未完成决策版本不可恢复')
      const explicit = record.explicit
      let measure: PolicyMeasure | undefined
      let capability: 'bounded' | 'analytical' | 'frontier' = 'bounded', depth: Depth = 'baseline'
      if (!explicit.model || !explicit.reasoningEffort) {
        // This is the exact child's entering message, not a parent-history/prompt similarity match.
        const text = userInput(decision.messages).text
        const result = await deps.jev.judgePolicy(buildState({ text }), payload.signal, 'child', explicit.model ? 'depth' : explicit.reasoningEffort ? 'capability' : 'both')
        if (!enabled(record.rootId)) { saveFailure('failed', '创建期间模式已变化'); throw new Error('policy-v2 创建期间模式已变化；请重新创建') }
        if (result.kind === 'cancelled') { saveFailure('failed', '初始判断已取消'); throw new Error('policy-v2 已取消') }
        if (result.kind === 'failed') { saveFailure('failed', result.category); throw new Error(`policy-v2 Jev 失败：${CATEGORY_HINTS[result.category]}；暂停委派并询问用户`) }
        if (result.capability === 'insufficient_context') { saveFailure('needs-context', '任务目标或范围不足'); throw new Error('policy-v2 needs-context：请补充任务目标与范围') }
        measure = result
        capability = result.capability ?? 'bounded'; depth = result.depth
      }
      try {
        const route = choosePolicyRoute(explicit.provider, capability, depth, await deps.catalog(), deps.settings().effortCap, explicit, record.family)
        const parent = ctx.agents.get(SessionId(record.parentId))
        const events: readonly { type: string; data: unknown }[] = parent?.session.snapshotEvents() ?? []
        const captured = events.find(event => event.type === 'subagent/model-selection-policy')
        if (captured) {
          const allowed = (captured.data as { allowedModels?: { provider: string; model: string }[] }).allowedModels
          if (!Array.isArray(allowed) || !allowed.some(item => item.provider === route.provider && item.model === route.model)) throw new Error('policy-v2 路由不在父会话创建时的官方允许列表中；请新建会话')
        }
        if (!enabled(record.rootId) || payload.signal.aborted) throw new Error('policy-v2 创建已取消或模式已变化')
        record = { ...record, route, status: 'recommended', decision: { id: ++decisionId, source: 'subagent', tier: capability, depth, capability, effort: route.reasoningEffort, model: route.model, provider: route.provider, status: 'recommended', ms: measure?.ms ?? 0, decisionProvider: measure?.decisionProvider ?? 'explicit', decisionModel: measure?.decisionModel ?? '未调用', ...(measure?.confidence !== undefined ? { confidence: measure.confidence } : {}), ...(measure?.capabilityConfidence !== undefined ? { capabilityConfidence: measure.capabilityConfidence } : {}), ...(measure?.probabilities ? { probabilities: measure.probabilities } : {}), ...(measure?.capabilityProbabilities ? { capabilityProbabilities: measure.capabilityProbabilities } : {}) } }; deps.store.set(record); pending.delete(agent.id)
      } catch (error) { saveFailure('failed', '配置不可用'); throw error }
    }
    if (!record.route && enabled(record.rootId)) throw new Error('policy-v2 决策未完成；暂停子请求')
    return decision
  })
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    const agent = payload.agent
    if (agent.session.header.origin !== 'subagent') {
      const runtime = main.get(agent)
      if (!runtime?.active || runtime.turn !== payload.turn || runtime.epoch !== epoch(agent.id) || !enabled(agent.id)) return config
      const info = await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal)
      if (!enabled(agent.id) || runtime.epoch !== epoch(agent.id) || payload.signal.aborted) return config
      const efforts = (info.reasoning?.efforts ?? []).map(e => String(e.id))
      if (!efforts.length) { const old = mainStatus.get(agent.id); mainStatus.set(agent.id, { ...old, policyVersion, depth: runtime.depth, reason: 'no-effort-support', ...(old?.decision ? { decision: { ...old.decision, status: 'unsupported', model: config.model, provider: config.provider, effort: '模型不支持调整' } } : {}) }); return config }
      const reasoningEffort = policyEffort(config.model, runtime.depth, efforts, deps.settings().effortCap, info.reasoning?.defaultEffort ? String(info.reasoning.defaultEffort) : undefined)
      mainStatus.set(agent.id, { ...mainStatus.get(agent.id), policyVersion, depth: runtime.depth, effort: reasoningEffort, reason: 'jev', ...(mainStatus.get(agent.id)?.decision ? { decision: { ...mainStatus.get(agent.id)!.decision!, effort: reasoningEffort, model: config.model, provider: config.provider } } : {}) })
      return { ...config, reasoningEffort } as typeof config
    }
    const record = deps.store.get(agent.id)
    requireBindingRecord(agent, record)
    if (record && !record.route) throw new Error('policy-v2 初始路由未完成；不静默继承')
    if (!record?.route) return config
    if (record.status === 'failed') throw new Error('policy-v2 实际应用失败；暂停子请求并询问用户')
    if (record.parentId !== agent.session.header.parentSession) throw new Error('policy-v2 决策身份不匹配')
    // Existing routed instances keep their initial route even when AUTO stops making new decisions.
    validatePolicyRoute(await deps.catalog(), record.route.provider, record.route.model, record.route.reasoningEffort, deps.settings().effortCap)
    return { ...config, ...record.route } as typeof config
  }, { prepend: true })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'assistant/message') {
      const d = applied.get(session.id)
      const data = event.data as { message?: { id?: string } }
      if (d?.status === 'applied' && enabled(session.id) && data.message?.id && d.model) {
        try { deps.feedback.bind({ sessionId: session.id, messageId: data.message.id, decisionId: d.id, depth: d.depth, model: d.model, effort: d.effort,
          ...(requestMetadata.has(session.id) && d.provider && decidedAt.has(d.id) ? { snapshot: {
            ...requestMetadata.get(session.id)!, decidedAt: decidedAt.get(d.id)!, policyVersion, mappingVersion,
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
      const status = mainStatus.get(session.id)
      const actual = (event.data as { header?: { config?: { provider?: string; model?: string; reasoningEffort?: string } } }).header?.config
      if (enabled(session.id) && status?.decision && actual) {
        const d = { ...status.decision, status: status.decision.status === 'unsupported' ? 'unsupported' : actual.reasoningEffort === status.effort && actual.provider === status.decision.provider && actual.model === status.decision.model ? 'applied' : 'failed', ...(actual.model ? { model: actual.model } : {}), ...(actual.provider ? { provider: actual.provider } : {}) }
        mainStatus.set(session.id, { ...status, decision: d }); latest.set(session.id, d)
        if (d.status === 'applied') {
          applied.set(session.id, d)
          const data = event.data as { turn?: number }
          requestMetadata.set(session.id, { requestSeq: event.seq, appliedAt: Date.now(), ...(typeof data.turn === 'number' ? { requestTurn: data.turn } : {}) })
        }
      }
      return
    }
    const actual = (event.data as { header?: { config?: { provider?: string; model?: string; reasoningEffort?: string } } }).header?.config
    if (!actual) return
    const matches = actual.provider === record.route.provider && actual.model === record.route.model && actual.reasoningEffort === record.route.reasoningEffort
    if (record.decision) latest.set(record.rootId, { ...record.decision, status: matches ? 'applied' : 'failed' })
    deps.store.set({ ...record, ...(record.decision ? { decision: { ...record.decision, status: matches ? 'applied' : 'failed' } } : {}), status: matches ? 'applied' : 'failed', ...(matches ? { actual: record.route } : { reason: '实际请求配置不匹配' }) })
    if (!matches) throw new Error('policy-v2 实际请求配置不匹配')
  })
  return {
    invalidate: (id: string) => { epochs.set(id, epoch(id) + 1); mainStatus.delete(id); latest.delete(id); applied.delete(id) },
    status: (id: string) => deps.store.get(id), mainStatus: (id: string) => enabled(id) ? { ...mainStatus.get(id), ...(latest.get(id) ? { decision: latest.get(id) } : {}) } : undefined,
  }
}
