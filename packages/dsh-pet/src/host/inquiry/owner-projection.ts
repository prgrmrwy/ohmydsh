import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  PetLocusInquiryProjection,
  PetLocusInquiryStatus,
  PetLocusInquiryView,
} from '../../wire.js'
import type { petDomainSpec } from '../spec.js'
import type { LocusRecord } from '../locus/aggregate.js'
import { parseInquiry } from './ledger.js'

const MAX_INQUIRIES = 10_000
const KNOWN_STATUSES = new Set<PetLocusInquiryStatus>([
  'queued', 'executing', 'answered', 'result-delivered', 'rejected',
  'unavailable', 'cancelled', 'needs-review', 'unknown',
])
const SAFE_REASONS = new Set([
  'inquiry-no-explicit-answer', 'inquiry-unavailable', 'inquiry-rejected',
  'inquiry-cancelled', 'inquiry-needs-review',
])
const DIAGNOSTIC_CODES = new Set([
  'late-answer', 'duplicate-answer', 'late-result', 'unknown-dispatch-outcome',
])

export interface InquiryOwnerProjectionInput {
  readonly locus: LocusRecord
  readonly parentSessionId: string
}

export interface InquiryOwnerProjectionOptions {
  readonly domain: Domain<typeof petDomainSpec>
  readonly capability: () => { readonly available: boolean; readonly reason?: string }
}

function unknown(code: string): PetLocusInquiryProjection {
  return { snapshotStatus: 'unknown', diagnostics: [{ code }] }
}

function matchesChild(record: ReturnType<typeof parseInquiry>, locus: LocusRecord): boolean {
  const matches = (scope: typeof record.requester) => scope.kind === 'child'
    && scope.sessionId === locus.childSessionId
    && scope.locusId === locus.id
    && scope.generation === locus.generation
  return matches(record.requester) || matches(record.target)
}

function mapStatus(status: string): PetLocusInquiryStatus {
  return KNOWN_STATUSES.has(status as PetLocusInquiryStatus)
    ? status as PetLocusInquiryStatus
    : 'unknown'
}

function safeReason(status: string, reason: string | null): string | undefined {
  if (reason === null) return undefined
  return SAFE_REASONS.has(reason) ? reason : 'inquiry-unavailable'
}

export function createInquiryOwnerProjection(options: InquiryOwnerProjectionOptions) {
  return (input: InquiryOwnerProjectionInput): PetLocusInquiryProjection => {
    const { locus, parentSessionId } = input
    if (!parentSessionId || parentSessionId !== locus.parentSessionId || !locus.id
      || !Number.isSafeInteger(locus.generation) || locus.generation < 1
      || typeof locus.childSessionId !== 'string' || !locus.childSessionId) {
      return unknown('inquiry-owner-scope-unknown')
    }

    let capability: { readonly available: boolean; readonly reason?: string } | undefined
    try {
      capability = options.capability()
    } catch {
      capability = undefined
    }
    const capabilityKnown = capability !== undefined && typeof capability.available === 'boolean'
    const capabilityCode = capabilityKnown
      ? capability!.available ? 'inquiry-dispatch-available' : 'inquiry-dispatch-unavailable'
      : 'inquiry-dispatch-unknown'

    let rows: PetLocusInquiryView[]
    try {
      const entries = [...options.domain.table('inquiries').entries()]
      if (entries.length > MAX_INQUIRIES) {
        return {
          snapshotStatus: 'unknown',
          dispatchCapability: capabilityKnown
            ? capability?.available ? 'available' : 'unavailable'
            : 'unknown',
          diagnostics: [{ code: 'inquiry-snapshot-limit-exceeded' }],
        }
      }
      rows = []
      for (const [key, value] of entries) {
        const record = parseInquiry(value)
        if (key !== record.id) throw new Error('inquiry key mismatch')
        if (record.circleParentSessionId !== parentSessionId
          || record.circleParentSessionId !== locus.parentSessionId
          || !matchesChild(record, locus)) continue
        const reason = safeReason(record.status, record.reason)
        const view: PetLocusInquiryView = {
          inquiryId: record.id,
          status: mapStatus(record.status),
          createdAt: record.createdAt,
          ...(reason ? { reason } : {}),
          ...(record.diagnostics.length
            ? { diagnostics: record.diagnostics
                .filter(item => DIAGNOSTIC_CODES.has(item.kind))
                .map(item => ({ code: item.kind, at: item.at })) }
            : {}),
        }
        rows.push(view)
      }
    } catch {
      return {
        snapshotStatus: 'unknown',
        dispatchCapability: capabilityKnown
          ? capability!.available ? 'available' : 'unavailable'
          : 'unknown',
        diagnostics: [{ code: 'inquiry-snapshot-read-failed' }],
      }
    }

    rows.sort((a, b) => a.createdAt - b.createdAt
      || (a.inquiryId ?? '').localeCompare(b.inquiryId ?? ''))
    return {
      snapshotStatus: 'available',
      dispatchCapability: capabilityKnown
        ? capability?.available ? 'available' : 'unavailable'
        : 'unknown',
      inquiries: rows,
      diagnostics: [{ code: capabilityCode }],
    }
  }
}
