/**
 * The ONE place that answers: may this v20 locus row serve ordinary work, and
 * if not, may the channel repair it without the owner?
 *
 * The distinction that matters is WHO made the row unavailable:
 * - `stopped` is an OWNER decision; an ordinary @ never revives it (only a
 *   same-W `/bind` does, design D7);
 * - `invalid` is a HOST judgement (child lost / identity unprovable); the next
 *   authorized @ rebuilds that one row in place;
 * - an archived W is the owner acting on the source, not on this row: the row
 *   keeps its `state` and the entry stops serving until the owner rebinds;
 * - an unavailable M (W healthy) is repaired by whole-W migration.
 */

import type { LocusStateV20 } from './contract-v20.js'

export type LocusDisposition =
  /** `active`: the child exists and may take work. */
  | { readonly kind: 'serve' }
  /** `not-created`: it takes work, the first deliverable message creates the child. */
  | { readonly kind: 'create' }
  | { readonly kind: 'replace'; readonly reason: string; readonly why: LocusReplaceWhy }
  | { readonly kind: 'terminal'; readonly reason: string; readonly workArchived: boolean }

/** Why a row is replaceable, so the right repair runs. */
export type LocusReplaceWhy =
  /** M is archived, deleted, mis-composed or outside the Pet workspace: whole-W migration. */
  | 'locus-main-unavailable'
  /** The Host judged this row's child unusable: in-place rebuild of the one row. */
  | 'child-unusable'

export interface ServiceabilitySubject {
  readonly state: LocusStateV20 | string
  readonly invalidReason?: string
  /** The W behind this entry is archived (proved from the Host, never persisted). */
  readonly workArchived?: boolean
  /** The M this row hangs under cannot serve. */
  readonly mainUnavailable?: boolean
}

/** Whether this state records an OWNER decision to take the entry out of service. */
export function isOwnerExit(state: string): boolean {
  return state === 'stopped'
}

/** Decide what may be done with one row. */
export function dispositionOf(subject: ServiceabilitySubject): LocusDisposition {
  // An archived W outranks every state, including `active`: the child is intact
  // and reachable, so nothing downstream would notice the owner archived the source.
  if (subject.workArchived === true) {
    return {
      kind: 'terminal',
      workArchived: true,
      reason: 'the source (work) session of this entry is archived; rebind it in the management surface',
    }
  }
  if (isOwnerExit(subject.state)) {
    return { kind: 'terminal', workArchived: false, reason: 'entry was stopped by its owner' }
  }
  if (subject.mainUnavailable === true) {
    return {
      kind: 'replace',
      why: 'locus-main-unavailable',
      reason: 'the locus main session of this entry is unavailable',
    }
  }
  if (subject.state === 'not-created') return { kind: 'create' }
  if (subject.state === 'active') return { kind: 'serve' }
  if (subject.state === 'invalid') {
    return {
      kind: 'replace',
      why: 'child-unusable',
      reason: subject.invalidReason === undefined
        ? 'row was invalidated by the Host'
        : `row was invalidated by the Host (${subject.invalidReason})`,
    }
  }
  return { kind: 'terminal', workArchived: false, reason: `row is ${subject.state}` }
}
