import { defineTool } from '@deepseek-ai/dsh-tools'
import { CHILD_TABLE } from './effort.js'
import { CATEGORY_HINTS, type JevClient } from './jev.js'
import type { Judgement } from './router.js'

/** Sub-agent decision tool: same Jev judgment as the main session, then the D9 child table. Writes no state. */
export function routeSubagentTool(jev: JevClient, judged: (sessionId: string, value: Omit<Judgement, 'id'>) => void = () => {}) {
  return defineTool({
    name: 'route_subagent',
    description: 'Pick provider/model/reasoning_effort for a sub-agent before delegating, using the Jev decision model. Sends the task text (up to 8000 characters) to OpenRouter/TypeSafe. On error: pause delegation and ask the user; never guess a tier.',
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
          tier: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          model: { type: 'string', required: true },
          reasoning_effort: { type: 'string', required: true },
        },
      },
      render: (_args, v) => [{ type: 'text', text: `Delegate with provider=${v.provider} model=${v.model} reasoning_effort=${v.reasoning_effort} (tier ${v.tier}); label the description [${v.model}·${v.reasoning_effort}].` }],
    },
    execute: async (args, exec) => {
      const result = await jev.judge(args.task.slice(0, 8000), undefined, exec.signal)
      if (result.kind === 'cancelled') throw new Error('route_subagent 已取消。')
      if (result.kind === 'failed') throw new Error(`Jev 判档失败：${CATEGORY_HINTS[result.category]}（${result.category}）。请暂停委派并询问用户，不要自行猜测档位或换用其它模型。`)
      const provider = args.provider as 'claude' | 'codex'
      const [model, effort] = CHILD_TABLE[result.tier][provider]
      // Attributed to the calling session so its chip can show the hint, whatever its mode.
      // A child session has no chip (the status endpoint rejects it), so only ordinary callers are recorded.
      const caller = exec.agent?.session.header.origin === 'subagent' ? undefined : exec.agent?.id
      if (caller) { const { kind: _, ...measure } = result; judged(caller, { source: 'subagent', model, effort, ...measure }) }
      return { tier: result.tier, provider, model, reasoning_effort: effort }
    },
  })
}
