import { isDeepStrictEqual } from 'node:util'
export const judgeSystemText = 'You are an AI agent powered by DeepSeek Harness.\n\nWhen you have your final answer, you MUST report it by calling the `structured_output` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result.'
export const judgeDelegationText = 'You are a delegated subagent: your permission scope was fixed when you were started and cannot be widened from inside this session — operations that require approval are rejected automatically. When the task needs access beyond that scope, do not retry the denied operation; state the limitation in your reply so the delegating agent can handle it.'
export function verifyJudgeMessages(messages: unknown, prompt: string): void {
  if (!Array.isArray(messages)) throw new Error('Invalid judge messages')
  let prompts = 0
  for (const message of messages as { role?: string; source?: { kind?: string }; content?: { type: string; text?: string }[] }[]) {
    const kind = message.source?.kind
    if (kind === 'user') {
      if (message.role !== 'user' || !isDeepStrictEqual(message.content, [{ type: 'text', text: prompt }])) throw new Error('Judge prompt mismatch')
      prompts++
    } else if (kind === 'system-prompt') {
      if (message.role !== 'system' || !isDeepStrictEqual(message.content, [{ type: 'text', text: judgeSystemText }])) throw new Error('Invalid judge system text')
    } else if (kind === 'runtime-context') {
      const expected = `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n${judgeDelegationText}`
      if (message.role !== 'user' || !isDeepStrictEqual(message.content, [{ type: 'text', text: expected }])) throw new Error('Invalid judge runtime context')
    } else throw new Error(`Forbidden judge message source: ${kind}`)
    if (!Array.isArray(message.content) || message.content.some(block => block.type !== 'text' || typeof block.text !== 'string')) throw new Error('Judge accepts text messages only')
  }
  if (prompts !== 1) throw new Error('Judge requires exactly one frozen prompt')
}
export interface JudgeProtocol { provider: string; model: string; effort?: string; schema: unknown; prompt: string }

/** Pure predicate for the root listener; the listener must also bind exact live child/owner and loop marker. */
export function verifyJudgeRequest(request: unknown, protocol: JudgeProtocol): void {
  if (!request || typeof request !== 'object') throw new Error('Invalid judge request')
  const value = request as Record<string, unknown>
  if (!Number.isSafeInteger(value.maxTokens) || (value.maxTokens as number) <= 0 || (value.maxTokens as number) > 2048) throw new Error('Judge output token limit mismatch')
  if (value.provider !== protocol.provider || value.model !== protocol.model || value.reasoningEffort !== protocol.effort) throw new Error('Judge route mismatch')
  if (value.system !== undefined) throw new Error('Judge request context mismatch')
  verifyJudgeMessages(value.messages, protocol.prompt)
  if (!Array.isArray(value.tools) || value.tools.length !== 1) throw new Error('Judge tool surface mismatch')
  const tool = value.tools[0] as Record<string, unknown>
  if (tool.name !== 'structured_output' || !isDeepStrictEqual(tool.parameters, protocol.schema)) throw new Error('Judge output schema mismatch')
  // No unverified route-projection history can override the audited declaration.
  if (value.toolHistory !== undefined && !isDeepStrictEqual(value.toolHistory, { tools: value.tools, updates: [] })) throw new Error('Unverified judge tool history')
}
