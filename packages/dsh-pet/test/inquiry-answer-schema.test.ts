import { describe, expect, it } from 'vitest'
import { emptyMedium, openPetHarness } from './harness.js'

const target = { kind: 'child', sessionId: 'session-b', locusId: 'locus-b', generation: 1 } as const
const validAnswer = {
  inquiryId: 'answer-1', answeredBy: target, answer: 'Persisted evidence.', confidence: 'confirmed',
  recency: 'current', sources: ['recorded work'], answeredAt: 1_800_000_000_000,
}

describe('durable inquiry answer schema', () => {
  it.each([
    ['invalid confidence', { ...validAnswer, confidence: 'certain' }],
    ['oversized answer', { ...validAnswer, answer: 'x'.repeat(8_193) }],
    ['malformed target', { ...validAnswer, answeredBy: { kind: 'child', sessionId: 's', locusId: 'l' } }],
  ])('rejects %s when reopening persisted JSON', async (_label, record) => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    await first.close()
    // Bypass typed writes deliberately: this models malformed serialized data
    // already on disk and asserts validation at the actual durable read boundary.
    medium.tables.inquiry_answers = { 'answer-1': JSON.stringify(record) }
    await expect(openPetHarness(medium)).rejects.toThrow()
  })

  it('reopens valid answers, but an empty answer table is not proof of answered state', async () => {
    const medium = emptyMedium()
    const first = await openPetHarness(medium)
    try {
      await first.domain.table('inquiry_answers').put(validAnswer.inquiryId, validAnswer)
    } finally { await first.close() }
    const reopened = await openPetHarness(medium)
    try {
      expect(reopened.domain.table('inquiry_answers').get('answer-1')).toEqual(validAnswer)
      expect(reopened.domain.table('inquiry_answers').size).toBe(1)
    } finally { await reopened.close() }

    const noAnswer = await openPetHarness(emptyMedium())
    try {
      expect(noAnswer.domain.table('inquiry_answers').size).toBe(0)
      expect(noAnswer.domain.table('inquiries').size).toBe(0)
    } finally { await noAnswer.close() }
  })

  it('rejects a v15 medium when opened by the v16 domain', async () => {
    const medium = emptyMedium()
    medium.version = 15
    await expect(openPetHarness(medium)).rejects.toThrow(/version/i)
  })
})
