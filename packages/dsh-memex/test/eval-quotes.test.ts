import { expect, it } from 'vitest'
import { checkQuotes } from '../src/eval/quotes.js'
const evidence = [{ id: 'event-1', text: 'lease_seconds is 45; retry_count is 4.' }]
it('requires a nonblank exact quote bound to supplied evidence identity', () => {
  expect(checkQuotes([{ source: 'event-1', quote: 'lease_seconds is 45' }], evidence)).toBe(true)
  for (const quotes of [[], [{ source: 'event-1', quote: ' ' }], [{ source: 'wrong', quote: 'lease_seconds is 45' }], [{ source: 'event-1', quote: 'lease_seconds is 15' }]]) expect(checkQuotes(quotes, evidence)).toBe(false)
})
it('quote presence only validates provenance, not the verdict meaning', () => {
  expect(checkQuotes([{ source: 'event-1', quote: 'retry_count' }], evidence)).toBe(true)
})
