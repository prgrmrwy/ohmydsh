import { expect, it } from 'vitest'
import { auditSessionEvents } from '../src/eval/event-audit.js'

it('reads effective headers and assistant usage, without counting a fork seed twice', () => {
  const header = { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm', reasoningEffort: 'high' } } } }
  const answer = { type: 'assistant/message', seq: 1, data: { usage: { inputTokens: 10, outputTokens: 3 }, stream: [] } }
  const events = auditSessionEvents([header, answer, { ...answer, seq: 2, data: { ...answer.data, usage: { inputTokens: 2, outputTokens: 1 } } }] as never, 2)
  expect(events).toEqual([{ type: 'request', seq: 2, route: { provider: 'p', model: 'm', effort: 'high' }, inputTokens: 2, outputTokens: 1, tokenCategories: { uncachedInput: 2, cacheRead: 0, cacheWrite: 0 } }])
})

it('recovers failed-attempt accounting from the raw usage record, including disjoint cached input', () => {
  const events = auditSessionEvents([
    { type: 'request/header', seq: 0, data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'assistant/attempt', seq: 1, data: { stream: [{ type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 10, cacheWriteTokens: 3 } } }] } },
  ] as never, 0)
  expect(events[0]).toMatchObject({ inputTokens: 15, outputTokens: 1, tokenCategories: { uncachedInput: 2, cacheRead: 10, cacheWrite: 3 } })
})

it('does not offset invalid negative cache usage against otherwise valid token counts', () => {
  const events = auditSessionEvents([{ type: 'assistant/message', seq: 0, data: { usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: -1 }, stream: [] } }] as never, 0)
  expect(events[0]?.inputTokens).toBeUndefined()
})

it('keeps failed attempts with unknown usage visible as evidence-missing', () => {
  expect(auditSessionEvents([{ type: 'assistant/attempt', seq: 1, data: { stream: [] } }] as never, 0)).toEqual([{ type: 'request', seq: 1 }])
})
