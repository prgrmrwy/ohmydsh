import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/**
 * One tool call through the DSH 0.2.2 batch entry point. 0.2.1 `tools.execute`
 * took a single `{ name, callId, arguments }` call and returned its result;
 * 0.2.2 takes `{ calls: ToolCallBlock[] }` and returns `{ results }`, with the
 * arguments as raw JSON text. This keeps the old call shape so each test still
 * asserts exactly the same single-call behaviour.
 */
export async function runTool(
  ctx: Context,
  call: { callId: ToolCallId; name: string; arguments: unknown; agent?: Agent; signal: AbortSignal },
) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments ?? {}) }],
    ...(call.agent === undefined ? {} : { agent: call.agent }),
    signal: call.signal,
  })
  return batch.results[0]!.result
}
