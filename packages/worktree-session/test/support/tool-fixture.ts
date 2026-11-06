import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'

/**
 * Test tool whose body returns model-facing content blocks directly. DSH 0.2.1 shipped
 * `defineContentToolFixture` from dsh-tools; 0.2.2 removed it (export list at
 * dsh-tools lib/index.js:665), so register the equivalent raw ToolDefinition.
 */
export function contentToolFixture(options: {
  name: string
  description: string
  execute(args: Record<string, unknown>): Promise<ContentBlock[]>
}) {
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: (value as { text: string }).text }],
    },
    async execute(args: unknown) {
      const blocks = await options.execute(args as Record<string, unknown>)
      return { text: blocks.map(block => (block.type === 'text' ? block.text : '')).join('') }
    },
  }
}

/** One tool call through the 0.2.2 batch entry point (`tools.execute` takes `{ calls }` and returns `{ results }`). */
export async function executeToolCall(ctx: Context, call: { callId: ToolCallId; name: string; arguments: Record<string, unknown>; agent: Agent; signal: AbortSignal }) {
  const batch = await ctx.tools.execute({
    calls: [{ type: 'tool-call', id: call.callId, name: call.name, arguments: JSON.stringify(call.arguments) }],
    agent: call.agent,
    signal: call.signal,
  })
  return batch.results[0]!.result
}
