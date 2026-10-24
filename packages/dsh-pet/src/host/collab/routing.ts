/**
 * Pure stamp, routing and visibility rules for the Locus collaboration space
 * (design D4, D5; AMD-1 for the `recordAt` lookup).
 *
 * Nothing here reads storage or the clock: dsh-collab supplies `recordAt`
 * from its own full replay when it asks `visible`, and Pet's `deliver` builds
 * the same lookup from `readManaged`. `locusId` in a stamp is the entry
 * identity from `locusIdentity` — these functions only compare it.
 */
import { MAIN_MEMBER, PET_MEMBER, mentionedLocusNames } from './naming.js'
import type { CollabExt, CollabItem, CollabLookup, CollabMessage, CollabRecordAt, CollabSubject } from './types.js'

/** The stamp Pet derives from an executing child: `{ pet: { locusId } }`. */
export function locusStamp(locusId: string): CollabExt {
  return { pet: { locusId } }
}

/** The locus identity a stamp or ext carries; undefined for anything malformed. */
export function stampLocusId(ext: unknown): string | undefined {
  if (typeof ext !== 'object' || ext === null || Array.isArray(ext)) return undefined
  const pet = (ext as { pet?: unknown }).pet
  if (typeof pet !== 'object' || pet === null || Array.isArray(pet)) return undefined
  const locusId = (pet as { locusId?: unknown }).locusId
  return typeof locusId === 'string' && locusId.length > 0 ? locusId : undefined
}

/** Where a record addressed to `pet` belongs. */
export type LocusRoute =
  | { readonly kind: 'locus'; readonly locusId: string; readonly via: 'ref' | 'mention' }
  | { readonly kind: 'unroutable' }

const UNROUTABLE: LocusRoute = Object.freeze({ kind: 'unroutable' })

function extOf(record: CollabRecordAt): unknown {
  return record.kind === 'item' ? record.item.ext : record.message.ext
}
function refOf(record: CollabRecordAt): number | undefined {
  return record.kind === 'item' ? record.item.ref : record.message.ref
}

/**
 * Rule 1: the nearest stamp walking back from the record itself along `ref`.
 * Refs strictly decrease, so the walk terminates; the step bound only guards
 * a malformed lookup. A broken chain simply yields no stamp.
 */
export function nearestStamp(start: CollabRecordAt, lookup: CollabLookup): string | undefined {
  let current: CollabRecordAt | undefined = start
  let previousRef = Number.POSITIVE_INFINITY
  for (let step = 0; current !== undefined && step < 10_000; step += 1) {
    const stamped = stampLocusId(extOf(current))
    if (stamped !== undefined) return stamped
    const ref = refOf(current)
    if (ref === undefined || !Number.isSafeInteger(ref) || ref >= previousRef) return undefined
    previousRef = ref
    current = lookup.recordAt(ref)
  }
  return undefined
}

/**
 * Rule 2: exactly one distinct `locus-<16 hex>` identity in the text, and it
 * is an identity of THIS parent session (retired entries included). The
 * mention IS the stamp value; zero, several or a foreign one do not match.
 */
export function mentionedLocus(text: string, parentLoci: readonly string[]): string | undefined {
  const names = mentionedLocusNames(text)
  if (names.length !== 1) return undefined
  return parentLoci.includes(names[0]!) ? names[0] : undefined
}

/**
 * Route one record addressed to `pet` (design D5).
 *
 * - A request terminal notice uses rule 1 only (the request carries its stamp).
 * - A message from `main` to `pet` uses rule 1, then rule 2.
 * - Everything else is unroutable.
 *
 * @param record - the waking subject.
 * @param lookup - creation-seq lookup over the same replayed space.
 * @param parentLoci - every locus identity of the space's parent session, retired included.
 */
export function routeToLocus(record: CollabRecordAt, lookup: CollabLookup, parentLoci: readonly string[]): LocusRoute {
  const byRef = nearestStamp(record, lookup)
  if (byRef !== undefined) return { kind: 'locus', locusId: byRef, via: 'ref' }
  if (record.kind === 'message' && record.message.actor === MAIN_MEMBER && record.message.to === PET_MEMBER) {
    const named = mentionedLocus(record.message.body, parentLoci)
    if (named !== undefined) return { kind: 'locus', locusId: named, via: 'mention' }
  }
  return UNROUTABLE
}

/**
 * May the child holding `stamp` see this subject? (design D4)
 *
 * - item: written by `main`, or carrying this very locus in its ext.
 * - message: carrying this locus; or `main` → `pet` and routed to exactly this
 *   locus. An unroutable message is visible to no child.
 * - statusText: only `main`'s; `pet`'s (written by any child) is never shown.
 *
 * Fails closed: a malformed stamp sees nothing.
 */
export function isVisibleToLocus(
  stamp: unknown,
  subject: CollabSubject,
  lookup: CollabLookup,
  parentLoci: readonly string[],
): boolean {
  const own = stampLocusId(stamp)
  if (own === undefined) return false
  switch (subject.kind) {
    case 'item':
      return subject.item.author === MAIN_MEMBER || stampLocusId(subject.item.ext) === own
    case 'message': {
      const message: CollabMessage = subject.message
      if (stampLocusId(message.ext) === own) return true
      if (message.actor !== MAIN_MEMBER || message.to !== PET_MEMBER) return false
      const route = routeToLocus({ kind: 'message', message }, lookup, parentLoci)
      return route.kind === 'locus' && route.locusId === own
    }
    case 'statusText':
      return subject.name === MAIN_MEMBER
    default:
      return false
  }
}

/** Convenience for building a lookup from item/message maps keyed by creation seq. */
export function lookupFrom(entries: Iterable<readonly [number, CollabRecordAt]>): CollabLookup {
  const bySeq = new Map(entries)
  return { recordAt: seq => bySeq.get(seq) }
}

export type { CollabItem }
