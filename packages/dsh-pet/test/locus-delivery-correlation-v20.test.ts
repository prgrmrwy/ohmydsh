/**
 * v20 Delivery correlation (owner A; design D3). Settlement and caller-bound
 * lookups match on (locusId, sessionId) only: no generation. A late event
 * from a replaced sessionId must not correlate with the current Delivery.
 * Spec: pet-locus-collaboration "投递与结算关联独立于会话运行状态".
 */
import { describe, expect, it } from 'vitest'
import { correlates, type DeliveryRecord } from '../src/host/locus/delivery.js'

const endpoint = { chatId: 'oc_1' }

function record(overrides: Record<string, unknown>): DeliveryRecord {
  return { deliveryId: 'd1', messageId: 'm1', endpoint, locusId: 'L1', sessionId: 'S-new', status: 'running', ...overrides } as unknown as DeliveryRecord
}

describe('correlates on (locusId, sessionId) (D3)', () => {
  it('matches the record whose sessionId equals the correlation sessionId', () => {
    expect(correlates(record({}), { endpoint, locusId: 'L1', sessionId: 'S-new' })).toBe(true)
  })

  it('does not match a late event from a replaced sessionId', () => {
    expect(correlates(record({}), { endpoint, locusId: 'L1', sessionId: 'S-old' })).toBe(false)
  })

  it('does not match when the locusId differs, even with the same sessionId', () => {
    expect(correlates(record({}), { endpoint, locusId: 'L2', sessionId: 'S-new' })).toBe(false)
  })
})
