import { expect, it } from 'vitest'
import { retiredInquiryOwnerProjection } from '../src/host/inquiry/retired-history.js'

it('reads and redacts retained inquiry history without mutating it', () => {
  const requester = { kind: 'main', sessionId: 'main' }
  const target = { kind: 'child', sessionId: 'child', locusId: 'legacy-1', generation: 1 }
  const row = { id: 'old', requester, target, circleParentSessionId: 'main', question: 'PRIVATE QUESTION', purpose: 'PRIVATE PURPOSE', origin: { kind: 'local' }, audience: { kind: 'local-session', sessionId: 'main' }, trace: { rootInquiryId: 'old', depth: 1, visited: [requester, target] }, createdAt: 1, status: 'executing', statusAt: 2, reason: null, appliedEventIds: [], diagnostics: [], droppedDiagnostics: 0 }
  const before = JSON.stringify(row)
  const projection = retiredInquiryOwnerProjection([row], { parentSessionId: 'main' })
  expect(projection).toEqual({ inquiry: { dispatchCapability: 'unavailable', snapshotStatus: 'available', inquiries: [{ inquiryId: 'old', status: 'executing', createdAt: 1 }] } })
  expect(JSON.stringify(projection)).not.toContain('PRIVATE')
  expect(retiredInquiryOwnerProjection([row], { parentSessionId: 'other' }).inquiry?.inquiries).toEqual([])
  expect(retiredInquiryOwnerProjection([{}], { parentSessionId: 'main' }).inquiry?.snapshotStatus).toBe('unavailable')
  expect(JSON.stringify(row)).toBe(before)
})
