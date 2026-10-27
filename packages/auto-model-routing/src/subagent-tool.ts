import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Settings, RoutingCatalog } from './settings-contract.js'
import type { JevClient } from './jev.js'
import { buildState } from './context.js'
import type { RoutingState } from './state.js'
import { choosePolicyRoute, modelFamily } from './routing.js'
import { registry as builtin, type Registry } from './strategies/index.js'

interface SessionLike { id: string; session: { header: { origin?: string; parentSession?: string } } }
export interface ToolDeps {
  /** Live agent registry (`ctx.agents`); used to walk a child up to its root session. */
  agents: { get(id: string): SessionLike | undefined }
  state: RoutingState
  readSettings: () => Settings
  catalog: () => RoutingCatalog | Promise<RoutingCatalog>
  registry?: Registry
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

const MANUAL_TEXT = '主会话为 MANUAL：不判断，按官方默认委派；只传用户或 lead 指定的值（例如指定的模型），不传其它 provider/model/reasoning_effort。'

/** Preview only: the same Jev judgment AUTO uses, while the root session is AUTO. Writes no state. */
export function routeSubagentTool(jev: JevClient, deps: ToolDeps) {
  const registry = deps.registry ?? builtin
  return defineTool({
    name: 'route_subagent',
    description: 'Optional preview of the AUTO sub-agent route: returns a recommendation only, never an applied route. Automatic routing happens when the official fresh creation tool creates the exact child, before its first request; use that tool directly and do not turn this recommendation into an explicit user constraint. Fork is unsupported. Sends the task text (redacted, up to 8000 characters) to the decision service chosen in settings only while the main session is AUTO; otherwise returns routed=false: delegate with the official defaults. If the user or lead already chose the model or effort, pass it: only the missing dimension is judged. On error: pause delegation and ask the user; never guess or switch models.',
    timeoutMs: 5000,
    parameters: {
      task: { type: 'string', required: true, description: 'The task the sub-agent will do.' },
      provider: { type: 'string', required: true, enum: registry.providers(), description: 'Exact transport provider of the sub-agent.' },
      model: { type: 'string', description: 'Sub-agent model already chosen by the user or lead; when given, only reasoning_effort is judged.' },
      reasoning_effort: { type: 'string', description: 'Effort already chosen by the user or lead; preserved and validated, never silently replaced.' },
      family: { type: 'string', enum: registry.ids(), description: 'Model family for an automatic model on a transport shared by several families; required there when no model is supplied.' },
      path: { type: 'string', enum: ['ordinary','fork','teammate'], description: 'Creation path; fork is unsupported.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          routed: { type: 'boolean' },
          status: { type: 'string' },
          capability: { type: 'string' },
          depth: { type: 'string' },
          reason: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { type: 'string' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: v.status === 'recommended'
        ? `Recommended only (not applied): ${v.provider}/${v.model}/${v.reasoning_effort}. Use the official creation tool; AUTO judges and binds the exact child before its first request. Do not copy this recommendation as a new explicit user constraint. Query the child routing status for applied evidence.`
        : v.status ? `${v.status}: ${v.reason}. 暂停委派并询问用户；不将推荐冒充实际应用。`
        : MANUAL_TEXT }],
    },
    execute: async (args, exec) => {
      const root = rootOf(exec.agent as SessionLike | undefined, deps.agents)
      // MANUAL (or disabled, or an unreachable root): no judgement and nothing leaves the machine.
      if (!root || deps.state.read(root.id).mode !== 'AUTO') return { routed: false, reason: 'manual' }
      if (args.path === 'fork') return { routed: false, status: 'unsupported', reason: 'fork 的真实历史兼容尚未验证；请改用 fresh' }
      const explicit = { ...(args.model ? { model: args.model } : {}), ...(args.reasoning_effort ? { reasoningEffort: args.reasoning_effort } : {}) }
      const result = explicit.model && explicit.reasoningEffort ? { kind: 'ok' as const, depth: 'baseline' as const, capability: 'bounded' as const }
        : await jev.judgePolicy(buildState({ text: args.task }), exec.signal, 'child', explicit.model ? 'depth' : explicit.reasoningEffort ? 'capability' : 'both')
      if (result.kind !== 'ok') throw new Error('Jev 判断失败或已取消；暂停委派并询问用户')
      if (result.capability === 'insufficient_context') return { routed: false, status: 'needs-context', reason: '请补充任务目标与范围' }
      let route: ReturnType<typeof choosePolicyRoute>
      try { route = choosePolicyRoute(args.provider, result.capability ?? 'bounded', result.depth, await deps.catalog(), deps.readSettings().effortCap, explicit, args.family ?? (args.model ? modelFamily(args.provider, args.model, registry) : undefined), registry) }
      catch (error) {
        // No usable route: never substitute another model or effort.
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(reason.includes('暂停委派并询问用户') ? reason : `${reason}；暂停委派并询问用户`)
      }
      return { status: 'recommended', ...(result.capability ? { capability: result.capability } : {}), depth: result.depth, provider: route.provider, model: route.model, reasoning_effort: route.reasoningEffort }
    },
  })
}
