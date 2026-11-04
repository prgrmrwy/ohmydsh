/** Read-only owner projection for retired inquiry rows; never schedules or rewrites them. */
import type { PetLocusOwnerProjection } from '../../wire.js'
import { parseInquiry } from './ledger.js'

export function retiredInquiryOwnerProjection(
  rows: Iterable<unknown>,
  locus: { readonly parentSessionId: string },
): PetLocusOwnerProjection {
  try {
    const inquiries = [...rows].map(parseInquiry)
      .filter(row => row.circleParentSessionId === locus.parentSessionId)
      .map(row => ({
        inquiryId: row.id,
        status: row.status === 'expired' ? 'unknown' as const : row.status,
        createdAt: row.createdAt,
        ...(row.reason === null ? {} : { reason: row.reason }),
      }))
    return { inquiry: { dispatchCapability: 'unavailable', snapshotStatus: 'available', inquiries } }
  } catch {
    // Invalid history must not become an empty list or leak its stored body.
    return { inquiry: { dispatchCapability: 'unavailable', snapshotStatus: 'unavailable', diagnostics: [{ code: 'retired-history-unreadable' }] } }
  }
}
