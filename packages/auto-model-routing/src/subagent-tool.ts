import { defineTool } from '@deepseek-ai/dsh-tools'
import { CHILD_MODELS, targetEffort, tiers, type ChildProvider } from './effort.js'
import { CATEGORY_HINTS, type JevClient } from './jev.js'
import { buildState } from './context.js'
import type { Judgement } from './router.js'
import type { RoutingState } from './state.js'

interface SessionLike { id: string; session: { header: { origin?: string; parentSession?: string } } }
export interface ToolDeps {
  /** Live agent registry (`ctx.agents`); used to walk a child up to its root session. */
  agents: { get(id: string): SessionLike | undefined }
  state: RoutingState
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

const MANUAL_TEXT = '主会话为 MANUAL：不判档，按官方默认委派，不传 provider/model/reasoning_effort。'

/** Sub-agent decision tool: same Jev judgment as the main session, only while the root session is AUTO. Writes no state. */
export function routeSubagentTool(jev: JevClient, deps: ToolDeps) {
  return defineTool({
    name: 'route_subagent',
    description: 'Pick provider/model/reasoning_effort for a sub-agent before delegating, using the Jev decision model. Sends the task text (redacted, up to 8000 characters) to OpenRouter/TypeSafe only while the main session is AUTO; otherwise returns routed=false: delegate with the official defaults. On error: pause delegation and ask the user; never guess a tier.',
    timeoutMs: 5000,
    parameters: {
      task: { type: 'string', required: true, description: 'The task the sub-agent will do.' },
      provider: { type: 'string', required: true, enum: ['claude', 'codex'], description: 'Provider family for the sub-agent.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          routed: { type: 'boolean' },
          reason: { type: 'string' },
          tier: { type: 'string' },
          provider: { type: 'string' },
          model: { type: 'string' },
          reasoning_effort: { type: 'string' },
        },
      },
      render: (_args, v) => [{ type: 'text', text: v.routed === false
        ? MANUAL_TEXT
        : `Delegate with provider=${v.provider} model=${v.model} reasoning_effort=${v.reasoning_effort} (tier ${v.tier}); label the description [${v.model}·${v.reasoning_effort}].` }],
    },
    execute: async (args, exec) => {
      const caller = exec.agent as SessionLike | undefined
      const root = rootOf(caller, deps.agents)
      // MANUAL (or disabled, or an unreachable root): no judgement and nothing leaves the machine.
      if (!root || deps.state.read(root.id).mode !== 'AUTO') return { routed: false, reason: 'manual' }
      const result = await jev.judge(buildState({ text: args.task }), exec.signal)
      if (result.kind === 'cancelled') throw new Error('route_subagent 已取消。')
      if (result.kind === 'failed') throw new Error(`Jev 判档失败：${CATEGORY_HINTS[result.category]}（${result.category}）。请暂停委派并询问用户，不要自行猜测档位或换用其它模型。`)
      const provider = args.provider as ChildProvider
      const model = CHILD_MODELS[provider][tiers.indexOf(result.tier)]!
      const effort = targetEffort(model, result.tier)
      // Shown on the caller's chip; a child caller has none, so only ordinary callers are recorded.
      if (caller === root) { const { kind: _, ...measure } = result; deps.judged?.(root.id, { source: 'subagent', model, effort, ...measure }) }
      return { tier: result.tier, provider, model, reasoning_effort: effort }
    },
  })
}
