import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { retiredInquiryOwnerProjection } from '../src/host/inquiry/retired-history.js'
import { LocusDetails } from '../src/client/settings.js'
import { collectHandleCodes, groupByWork } from '../src/client/locus-view.js'
import { locusFixture, snapshotOf } from './fixtures/locus-snapshot.js'

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

it('marks historical inquiry records retired without claiming execution can resume', () => {
  const locus = { ...locusFixture({ locusId: 'legacy-1', chatId: 'oc_legacy', parentSessionId: 'main' }), owner: { inquiry: { dispatchCapability: 'unavailable' as const, snapshotStatus: 'available' as const, inquiries: [{ inquiryId: 'old', status: 'executing' as const, createdAt: 1 }] } } }
  const snapshot = snapshotOf([locus])
  const markup = renderToStaticMarkup(createElement(LocusDetails, { family: groupByWork(snapshot)[0]!.families[0]!, codes: collectHandleCodes(snapshot), busy: false, busyKey: undefined, onAction: () => undefined }))
  expect(markup).toContain('询问已退役')
  expect(markup).toContain('仅保留只读历史，不再续进')
  expect(markup).not.toContain('询问派发')
  expect(markup).not.toContain('询问 执行中')
})
