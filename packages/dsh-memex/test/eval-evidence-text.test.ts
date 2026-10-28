import { expect, it } from 'vitest'
import { assistantEvidence } from '../src/eval/evidence-text.js'
it('exports visible answer text with session/seq identity but never reasoning or stream deltas', () => {
  expect(assistantEvidence('reserved', [{ type: 'assistant/message', seq: 3, data: { message: { content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Visible answer' }] }, stream: [{ secret: 'delta' }] } }] as never, 0)).toEqual([{ id: 'reserved:3', text: 'Visible answer' }])
})
it('excludes inherited assistant seed and non-answer records', () => {
  expect(assistantEvidence('child', [{ type: 'assistant/message', seq: 0, data: { message: { content: [{ type: 'text', text: 'seed' }] } } }, { type: 'tool/call', seq: 1, data: {} }] as never, 1)).toEqual([])
})
