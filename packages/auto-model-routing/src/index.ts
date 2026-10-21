import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { FileStateStore, RoutingState } from './state.js'
import { Router, type AgentRef, type RequestConfig } from './router.js'
import type { Effort } from './effort.js'
import { endpoint } from './endpoints.js'
import { JevClient } from './jev.js'
import { routeSubagentTool } from './subagent-tool.js'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

export const name = 'dsh-auto-model-routing'
export const inject = ['llm', 'agents', 'tools']
const knownEfforts = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Test seams only; production uses the defaults. */
export interface Config { home?: string; jevBase?: string; jevTimeoutMs?: number }

export function apply(ctx: Context, config: Config = {}): void {
  const home = config.home ?? process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  const jev = new JevClient(launchEnvironmentOf(ctx), config.jevBase, config.jevTimeoutMs)
  const state = new RoutingState(new FileStateStore(resolve(home, 'state/auto-model-routing/sessions')))
  const router = new Router(state)
  const configFile = resolve(home, 'plugins/dsh-auto-model-routing/config.json')
  // Read on every status request so the switch applies without a restart; any problem means off.
  const toastOn = (): boolean => {
    try { return (JSON.parse(readFileSync(configFile, 'utf8')) as { decisionToast?: unknown })?.decisionToast === true } catch { return false }
  }
  ctx.effect(() => ctx.tools.register(routeSubagentTool(jev, (sessionId, value) => router.judged(sessionId, value))))
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
    const job = router.begin(agent, payload.turn, decision.messages)
    if (!job) return decision
    const result = await jev.judge(job.text, job.previous, payload.signal)
    if (result.kind === 'ok') { const { kind: _, tier, ...measure } = result; router.resolve(agent, payload.turn, tier, measure) }
    else if (result.kind === 'failed') router.fail(agent, payload.turn, result.category)
    else router.cancel(agent, payload.turn)
    return decision
  })
  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    if (payload.agent.session.header.origin === 'subagent') return config
    const model = router.needsModelInfo(ref(payload.agent)) ? await ctx.llm.resolveModelInfo(config.provider, config.model, payload.signal) : undefined
    const efforts = (model?.reasoning?.efforts ?? []).map(effort => effort.id).filter(id => knownEfforts.has(id)) as Effort[]
    return router.request(ref(payload.agent), payload.turn, config as unknown as RequestConfig, efforts) as unknown as typeof config
  }, { prepend: true })

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
          }, router, state, toastOn)
          if (!enveloped) return response
          const value = await response.json()
          return Response.json({ type: 'server-response', rpcId: wire.rpcId, result: response.ok ? { ok: true, value } : { ok: false, error: { code: 'invalid-request', message: value.error, details: {} } } })
        },
      }))
    }
  })
}
