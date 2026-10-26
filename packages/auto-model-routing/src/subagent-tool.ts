import { defineTool } from '@deepseek-ai/dsh-tools'
import { CHILD_MODELS, mapEffort, tiers, type ChildProvider, type Effort } from './effort.js'
import { explicitChildRoute, SettingsValidationError } from './settings.js'
import { DEFAULT_SETTINGS, type Settings, type RoutingCatalog } from './settings-contract.js'
import { validateChildRoute } from './settings-validation.js'
import { CATEGORY_HINTS, type JevClient } from './jev.js'
import { buildState } from './context.js'
import type { Judgement } from './router.js'
import type { RoutingState } from './state.js'
import { choosePolicyRoute, magpieProvider, modelFamily, POLICY_PROVIDERS, type PolicyProvider } from './policy-v2.js'
import { policyVersion } from './jev.js'

interface SessionLike { id: string; session: { header: { origin?: string; parentSession?: string } } }
export interface ToolDeps {
  /** Live agent registry (`ctx.agents`); used to walk a child up to its root session. */
  agents: { get(id: string): SessionLike | undefined }
  state: RoutingState
  readSettings?: () => Settings
  catalog?: () => RoutingCatalog | Promise<RoutingCatalog>
  judged?: (sessionId: string, value: Omit<Judgement, 'id'>) => void
}

/** The ordinary session a caller belongs to; undefined when any link is no longer live (treated as MANUAL). */
function rootOf(caller: SessionLike | undefined, agents: ToolDeps['agents']): SessionLike | undefined {
  let current = caller
  for (let depth = 0; current && depth < 32; depth++) {
    if (current.session.header.origin !== 'subagent') return current
    const parent = current.session.header.parentSession
    current = parent ? agents.get(parent) : undefined
  }
  return undefined
}

const MANUAL_TEXT = '主会话为 MANUAL：不判档，按官方默认委派；只传用户或 lead 指定的值（例如指定的模型），不传其它 provider/model/reasoning_effort。'

/** Sub-agent decision tool: same Jev judgment as the main session, only while the root session is AUTO. Writes no state. */
export function routeSubagentTool(jev: JevClient, deps: ToolDeps) {
  return defineTool({
    name: 'route_subagent',
    description: 'When policy-v2 is selected, this tool is an optional preview only: use the official fresh creation tool directly for exact-child automatic routing, do not turn preview output into explicit user constraints; fork is unsupported. Under the legacy policy: Call before every sub-agent delegation, whatever the task size. Picks provider/model/reasoning_effort with the Jev decision model; pass provider, model and reasoning_effort explicitly to the sub-agent tool, or the sub-agent inherits this session\'s effort. Sends the task text (redacted, up to 8000 characters) to OpenRouter/TypeSafe only while the main session is AUTO; otherwise returns routed=false: delegate with the official defaults. If the user or lead already chose the sub-agent model, pass it as model: only reasoning_effort is routed and the model is kept. On error: pause delegation and ask the user; never guess a tier.',
    timeoutMs: 5000,
    parameters: {
      task: { type: 'string', required: true, description: 'The task the sub-agent will do.' },
      provider: { type: 'string', required: true, enum: [...POLICY_PROVIDERS], description: 'Exact transport provider. Magpie is available only under policy-v2.' },
      model: { type: 'string', description: 'Sub-agent model already chosen by the user or lead; when given, only reasoning_effort is routed.' },
      reasoning_effort: { type: 'string', description: 'Explicit effort constraint for policy-v2; preserved and validated, never silently replaced.' },
      family: { type: 'string', enum: ['claude','codex'], description: 'Magpie automatic capability family; required when no model is explicitly supplied.' },
      path: { type: 'string', enum: ['ordinary','fork','teammate'], description: 'policy-v2 creation path; fork remains unsupported until real history compatibility is verified.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          routed: { type: 'boolean' },
          status: { type: 'string' },
          policyVersion: { type: 'string' },
          capability: { type: 'string' },
          depth: { type: 'string' },
          reason: { type: 'string' },
          tier: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { type: 'string' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: v.status ? (v.status === 'recommended'
        ? `policy-v2 recommended only (not applied): ${v.provider}/${v.model}/${v.reasoning_effort}. Use the official creation tool; AUTO judges and binds the exact child before its first request. Do not copy this recommendation as a new explicit user constraint. Query the child routing status for applied evidence.`
        : `policy-v2 ${v.status}: ${v.reason}. 暂停委派并询问用户；不将推荐冒充实际应用。`)
        : v.routed === false
        ? MANUAL_TEXT
        : `Delegate with provider=${v.provider} model=${v.model} reasoning_effort=${v.reasoning_effort} (tier ${v.tier}); label the description [${v.model}·${v.reasoning_effort}].` }],
    },
    execute: async (args, exec) => {
      const caller = exec.agent as SessionLike | undefined
      const root = rootOf(caller, deps.agents)
      // MANUAL (or disabled, or an unreachable root): no judgement and nothing leaves the machine.
      if (!root || deps.state.read(root.id).mode !== 'AUTO') return { routed: false, reason: 'manual' }
      if (deps.readSettings?.().policy === 'policy-v2') {
        if (args.path === 'fork') return { routed: false, status: 'unsupported', policyVersion, reason: 'fork 真实历史兼容尚未验证；选择 fresh 或由用户关闭试验后继承' }
        const explicit = { ...(args.model ? { model: args.model } : {}), ...(args.reasoning_effort ? { reasoningEffort: args.reasoning_effort } : {}) }
        const result = explicit.model && explicit.reasoningEffort ? { kind: 'ok' as const, depth: 'baseline' as const, capability: 'bounded' as const }
          : await jev.judgePolicy(buildState({ text: args.task }), exec.signal, 'child', explicit.model ? 'depth' : explicit.reasoningEffort ? 'capability' : 'both')
        if (result.kind !== 'ok') throw new Error('policy-v2 Jev 判断失败或取消；暂停委派并询问用户')
        if (result.capability === 'insufficient_context') return { routed: false, status: 'needs-context', policyVersion, reason: '请补充任务目标与范围' }
        const route = choosePolicyRoute(args.provider as PolicyProvider, result.capability ?? 'bounded', result.depth, await deps.catalog!(), deps.readSettings!().effortCap, explicit, args.family ?? (args.model ? modelFamily(args.provider, args.model) : undefined))
        return { status: 'recommended', policyVersion, ...(result.capability ? { capability: result.capability } : {}), depth: result.depth, provider: route.provider, model: route.model, reasoning_effort: route.reasoningEffort }
      }
      if (magpieProvider(args.provider)) throw new Error('Magpie 路由需显式选择 policy-v2；原策略不变')
      const result = await jev.judge(buildState({ text: args.task }), exec.signal)
      if (result.kind === 'cancelled') throw new Error('route_subagent 已取消。')
      if (result.kind === 'failed') throw new Error(`Jev 判档失败：${CATEGORY_HINTS[result.category]}（${result.category}）。请暂停委派并询问用户，不要自行猜测档位或换用其它模型。`)
      const provider = args.provider as ChildProvider
      const defaultModel = CHILD_MODELS[provider][tiers.indexOf(result.tier)]!
      let model: string
      let effort: Effort
      try {
        // Legacy callers without settings/catalog keep the original table; the Host always supplies both.
        const catalog = deps.catalog ? await deps.catalog() : {
          models: deps.readSettings ? [] : [{ provider, model: defaultModel, name: defaultModel, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }],
          childAllowlist: { status: 'enabled' as const, allowedModels: deps.readSettings ? [] : [{ provider, model: defaultModel }] },
        }
        if (exec.signal.aborted) throw new Error('cancelled')
        const settings = deps.readSettings?.() ?? DEFAULT_SETTINGS
        // A caller-chosen model skips the tier→model table entirely (childRoutes included); only effort is routed.
        const explicit = args.model ? undefined : explicitChildRoute(settings, provider, result.tier, catalog)
        model = args.model || (explicit?.model ?? defaultModel)
        const supported = catalog.models.find(entry => entry.provider === provider && entry.model === model)?.reasoningEfforts ?? []
        const mapped = explicit?.reasoningEffort ?? mapEffort(model, result.tier, supported as readonly Effort[], settings.effortCap)
        if (!mapped || validateChildRoute(catalog, provider, { model, reasoningEffort: mapped }, settings.effortCap).length) throw new SettingsValidationError([])
        effort = mapped
      } catch {
        if (exec.signal.aborted) throw new Error('route_subagent 已取消。')
        throw new Error('自动模型路由设置无效。请暂停委派并询问用户，修复设置后重试，不要自行换路由。')
      }
      // Shown on the caller's chip; a child caller has none, so only ordinary callers are recorded.
      if (caller === root) { const { kind: _, ...measure } = result; deps.judged?.(root.id, { source: 'subagent', model, effort, ...measure }) }
      return { tier: result.tier, provider, model, reasoning_effort: effort }
    },
  })
}
