import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-llm'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { FileStateStore, RoutingState, type Selection } from './state.js'
import { Router, type AgentRef, type RequestConfig } from './router.js'
import type { Effort } from './classifier.js'
import { endpoint } from './endpoints.js'
import { selectionProjection } from './selection-projection.js'

export const name = 'dsh-auto-model-routing'
export const inject = ['llm', 'agents', 'sessionProjections']
const knownEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

export function apply(ctx: Context): void {
  const home = process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  const state = new RoutingState(new FileStateStore(resolve(home, 'state/auto-model-routing/sessions')))
  const router = new Router(state)
  ctx.effect(() => ctx.sessionProjections.register(selectionProjection))
  // Agent is the WeakMap identity; origin stays on the immutable session header.
  const refs = new WeakMap<object, AgentRef>()
  const ref = (agent: { id: string; session: { header: { origin?: string } } }): AgentRef => {
    let value = refs.get(agent)
    if (!value) { value = { id: agent.id, ...(agent.session.header.origin ? { origin: agent.session.header.origin } : {}) }; refs.set(agent, value) }
    return value
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    if (payload.step === 1) router.begin(ref(payload.agent), payload.turn, payload.messages)
    return next()
  })
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (payload.agent.session.header.origin === 'subagent') return config
    const selection = ctx.sessionProjections.stateOf(payload.agent.session, 'autoRoutingSelection')
    if (selection) state.select(payload.agent.id, selection)
    const model = router.needsModelInfo(ref(payload.agent)) ? await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal) : undefined
    const efforts = (model?.reasoning?.efforts ?? []).map(effort => effort.id).filter(id => knownEfforts.has(id)) as Effort[]
    return router.request(ref(payload.agent), payload.turn, config as unknown as RequestConfig, efforts, payload.agent.session.requestHeader()?.config as Selection | undefined) as unknown as typeof config
  }, { prepend: true })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'model/selection' && session.header.origin !== 'subagent') state.select(session.id, event.data as Selection)
  })

  ctx.inject(['connection', 'sessionController'], child => {
    for (const operation of ['state', 'setMode'] as const) {
      child.effect(() => child.connection.fetch.register({
        path: `/api/auto-model-routing.${operation}`,
        methods: ['POST'], requestBody: 'buffered',
        fetch: async (request) => {
          let body: unknown
          try { body = await request.json() } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }) }
          const wire = body as { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown } | null
          const enveloped = wire?.type === 'client-request'
          if (enveloped && (typeof wire.rpcId !== 'string' || wire.method !== `auto-model-routing.${operation}`)) return Response.json({ error: 'invalid RPC envelope' }, { status: 400 })
          const response = await endpoint(operation, enveloped ? wire.payload : body, async id => {
            const result = await child.sessionController.resolveAgent(id as never)
            return 'agent' in result ? ref(result.agent) : undefined
          }, router, state)
          if (!enveloped) return response
          const value = await response.json()
          return Response.json({ type: 'server-response', rpcId: wire.rpcId, result: response.ok ? { ok: true, value } : { ok: false, error: { code: 'invalid-request', message: value.error, details: {} } } })
        },
      }))
    }
  })
}
