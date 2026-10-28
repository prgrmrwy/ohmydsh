import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { AuditEvent } from './audit.js'
import type { ModelRoute } from './round.js'

/** The inherited prefix comes from the official persisted Session metadata, not a guessed marker. */
export function auditSessionEvents(events: readonly SessionEvent[], inheritedEventCount: number): AuditEvent[] {
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0 || inheritedEventCount > events.length) throw new Error('Invalid inherited prefix')
  let route: ModelRoute | undefined
  const result: AuditEvent[] = []
  for (const event of events) {
    if (event.type === 'request/header') {
      const config = event.data.header.config
      route = typeof config.provider === 'string' && typeof config.model === 'string'
        ? { provider: config.provider, model: config.model, ...(config.reasoningEffort === undefined ? {} : { effort: config.reasoningEffort }) } : undefined
    }
    if (event.seq < inheritedEventCount || (event.type !== 'assistant/message' && event.type !== 'assistant/attempt')) continue
    const usages = event.data.stream.flatMap(record => record.type === 'chunk' && record.chunk.type === 'usage' ? [record.chunk.usage] : [])
    const usage = event.type === 'assistant/message' ? event.data.usage : usages.length === 1 ? usages[0] : undefined
    const validUsage = usage && [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0].every(n => Number.isSafeInteger(n) && n >= 0)
    const content = event.type === 'assistant/message' ? event.data.message?.content : undefined
    result.push({ type: 'request', seq: event.seq, ...(content ? { toolCalls: content.filter(block => block.type === 'tool-call').length } : {}), ...(route ? { route: { ...route } } : {}),
      ...(validUsage ? { inputTokens: usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0), outputTokens: usage.outputTokens, tokenCategories: { uncachedInput: usage.inputTokens, cacheRead: usage.cacheReadTokens ?? 0, cacheWrite: usage.cacheWriteTokens ?? 0 } } : {}) })
  }
  return result
}
