import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import { SettingsStore } from './settings.js'
import { settingsHost } from './settings-host.js'
import { homedir } from 'node:os'
import { FileStateStore, RoutingState } from './state.js'
import { Router, type AgentRef, type RequestConfig } from './router.js'
import type { Effort } from './effort.js'
import { endpoint, labelEndpoint } from './endpoints.js'
import { JudgementBook } from './judgements.js'
import { userInput } from './input.js'
import { JevClient, rubricVersion } from './jev.js'
import { routeSubagentTool } from './subagent-tool.js'
import { buildState, previousTurn } from './context.js'

export const name = 'dsh-auto-model-routing'
export const inject = ['llm', 'agents', 'tools']
const knownEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Test seams only; production uses the defaults. */
export interface Config { home?: string; jevBase?: string; jevTimeoutMs?: number }

export function apply(ctx: Context, config: Config = {}): void {
  const home = config.home ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  const settings = new SettingsStore(resolve(home, 'plugins/dsh-auto-model-routing/config.json'))
  const hostSettings = settingsHost(ctx, settings)
  const jev = new JevClient({ get: hostSettings.credential }, config.jevBase, config.jevTimeoutMs ?? (() => settings.read().settings.jevTimeoutMs))
  const stateFiles = new FileStateStore(resolve(home, 'state/auto-model-routing/sessions'))
  const state = new RoutingState(stateFiles)
  const book = new JudgementBook(resolve(home, 'state/auto-model-routing/judgements.jsonl'))
  const router = new Router(state, (sessionId, turn, tier, model, effort) => {
    const line = { sessionId, turn, tier, ...(effort ? { effort } : {}), model, rubricVersion }
    book.judged(line)
    // Recording is best effort: a failed append never touches the request or the mode.
    try { book.append(line) }
    catch (error) { ctx.logger.warn(`auto-model-routing: could not record the judgement: ${String(error)}`) }
  }, () => settings.read().settings)
  const toastOn = (): boolean => settings.read().settings.decisionToast
  ctx.effect(() => ctx.tools.register(routeSubagentTool(jev, { agents: ctx.agents as never, state, readSettings: () => settings.read().settings, catalog: hostSettings.catalog, judged: (sessionId, value) => router.judged(sessionId, value) })))
  ctx.on('agent/created', ({ agent, source }) => {
    // Factory resume announces `resume`; a nonzero initial seed also excludes restored/forked histories.
    if (source !== 'startup' || agent.session.header.origin === 'subagent' || agent.session.firstLiveSeq !== 0 || agent.session.header.isSeeded || agent.session.snapshotEvents().some(event => event.type === 'session/end-seed') || stateFiles.get(agent.id)) return
    if (settings.read().settings.defaultMode === 'AUTO') state.setMode(agent.id, 'AUTO')
    return undefined
  })
  // Agent is the WeakMap identity; origin stays on the immutable session header.
  const refs = new WeakMap<object, AgentRef>()
  const ref = (agent: { id: string; session: { header: { origin?: string } } }): AgentRef => {
    let value = refs.get(agent)
    if (!value) { value = { id: agent.id, ...(agent.session.header.origin ? { origin: agent.session.header.origin } : {}) }; refs.set(agent, value) }
    return value
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    // Judge only steps that actually enter, using the messages that enter (a rejected step sends nothing).
    if (payload.step !== 1 || decision.kind !== 'enter') return decision
    const agent = ref(payload.agent)
    if (agent.origin !== 'subagent' && userInput(decision.messages).userTurn) book.userTurn(agent.id, payload.turn)
    const job = router.begin(agent, payload.turn, decision.messages)
    if (!job) return decision
    // History before this turn's messages enter: the previous user message and assistant reply.
    const prior = previousTurn(payload.agent.session.deriveMessages())
    const result = await jev.judge(buildState({ previous: job.previous, prevUser: prior.user, prevAssistant: prior.assistant, text: job.text }), payload.signal)
    if (result.kind === 'ok') { const { kind: _, tier, ...measure } = result; router.resolve(agent, payload.turn, tier, measure) }
    else if (result.kind === 'failed') router.fail(agent, payload.turn, result.category)
    else router.cancel(agent, payload.turn)
    return decision
  })
  // Reply → user turn, for the reply-bar tier button (memory only; empty after a restart).
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message') return
    const data = event.data as { turn: number; message: { id: string } }
    book.assistant(session.id, data.message.id, data.turn)
  })
  // Official selection writer, set while the session controller is available.
  let selectModel: ((request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }) => Promise<unknown>) | undefined
  const inflight = new Map<string, string>()
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (payload.agent.session.header.origin === 'subagent') return config
    const model = router.needsModelInfo(ref(payload.agent)) ? await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal) : undefined
    const efforts = (model?.reasoning?.efforts ?? []).map(effort => effort.id).filter(id => knownEfforts.has(id)) as Effort[]
    const catalog = model && settings.read().settings.mainEfforts ? await hostSettings.catalog() : undefined
    const routed = router.request(ref(payload.agent), payload.turn, config as unknown as RequestConfig, efforts, catalog)
    // AUTO moved the effort away from the official selection: make that selection (and the picker) carry it.
    // `config` is the official selection for this request, so a user pick made since the last sync is caught too.
    // Not awaited and never fatal; `inflight` only stops repeat calls before the first one lands.
    if (selectModel && routed.reasoningEffort && routed.reasoningEffort !== config.reasoningEffort) {
      const key = `${routed.provider}\0${routed.model}\0${routed.reasoningEffort}`
      if (inflight.get(payload.agent.id) !== key) {
        inflight.set(payload.agent.id, key)
        selectModel({ sessionId: payload.agent.id, provider: routed.provider, model: routed.model, reasoningEffort: routed.reasoningEffort })
          .catch(error => ctx.logger.warn(`auto-model-routing: could not sync the model selection: ${String(error)}`))
          .finally(() => { if (inflight.get(payload.agent.id) === key) inflight.delete(payload.agent.id) })
      }
    }
    return routed as unknown as typeof config
  }, { prepend: true })

  ctx.inject(['sessionController'], child => {
    selectModel = request => child.sessionController.selectModel(request as never)
    child.effect(() => () => { selectModel = undefined })
  })

  ctx.inject(['connection', 'sessionController'], child => {
    for (const operation of ['state', 'setMode', 'label', 'settings', 'saveSettings', 'setKey'] as const) {
      child.effect(() => child.connection.fetch.register({
        path: `/api/auto-model-routing.${operation}`,
        methods: ['POST'], requestBody: 'buffered',
        fetch: async (request) => {
          let body: unknown
          try { body = await request.json() } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }) }
          const wire = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null
          const enveloped = wire?.type === 'client-request'
          if (enveloped && (typeof wire.rpcId !== 'string' || wire.method !== `auto-model-routing.${operation}`)) return Response.json({ error: 'invalid RPC envelope' }, { status: 400 })
          const resolveAgent = async (id: string) => {
            const result = await child.sessionController.resolveAgent(id as never)
            return 'agent' in result ? ref(result.agent) : undefined
          }
          const payload = enveloped ? wire.payload : body
          const response = operation === 'settings' || operation === 'saveSettings' || operation === 'setKey'
            ? await hostSettings.endpoint(operation, payload)
            : operation === 'label' ? await labelEndpoint(payload, resolveAgent, book) : await endpoint(operation, payload, resolveAgent, router, state, toastOn)
          if (!enveloped) return response
          const value = await response.json()
          return Response.json({ type: 'server-response', rpcId: wire.rpcId, result: response.ok ? { ok: true, value } : { ok: false, error: { code: 'invalid-request', message: value.error, details: { issues: value.issues ?? [] } } } })
        },
      }))
    }
  })
}
