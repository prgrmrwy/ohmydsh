/**
 * The ONE place that answers: may this locus generation serve ordinary work,
 * and if not, may the channel establish a replacement for it?
 *
 * Why this module exists
 * ----------------------
 * Teaching the channel to recover a generation the HOST invalidated took three
 * rounds and six edits, because that single policy was hand-written in six
 * places using three different vocabularies (`LocusState`,
 * `LocusAuthorizationState`, and per-layer allowlists). Each layer refused
 * independently, so every fix only moved the refusal one layer deeper:
 *
 *   1. `admission.ts`            — authorization state
 *   2. `channel/locus-controller.ts` — the accepted-state allowlist
 *   3. `locus/resolution.ts`     — `toActive()`
 *   4. `locus/controller.ts`     — `ensureGroup()` / `requireActiveLocus()`
 *   5. `locus/controller.ts`     — rebuild had no usable parent
 *   6. `channel/locus-controller.ts` — a read refusal short-circuited the
 *      establishing path entirely
 *
 * The concept being encoded is small and stable; the duplication was the
 * defect. Callers should ask THIS module rather than restating any subset of
 * the rules, so a future policy change is one edit with the compiler pointing
 * at every consumer.
 *
 * The distinction that matters
 * ----------------------------
 * `stopped` / `retired` record an OWNER decision. The spec is explicit:
 * "明确退出的入口 SHALL 保留停止标记，普通 at MUST NOT 自动复活" — an ordinary
 * mention must never resurrect a deliberate exit, and the owner rebuilds it
 * from the panel.
 *
 * `invalid` records a HOST judgement — a child that failed to re-attach after
 * a restart, or a generation with no safe-v1 composition proof. The owner
 * decided nothing, so there is no intent to preserve and no exit to honour.
 * Requiring an explicit rebuild here is what stranded endpoints: the panel
 * offers that rebuild only against the generation's own recorded parent,
 * which may itself be archived, making the repair impossible.
 */

import {
  LOCUS_SAFE_CHILD_COMPOSITION,
  type LocusState,
} from './aggregate.js'

/**
 * What the channel may do with one generation.
 *
 * - `serve`    — it can take ordinary work now.
 * - `replace`  — it cannot, but the channel may establish a NEW generation
 *                without the owner asking. The unavailable generation itself
 *                is still never served or resumed; see `toActive`'s use.
 * - `terminal` — it cannot, and only the owner may act. Ordinary work is
 *                refused with a reason a member can relay.
 */
export type LocusDisposition =
  /**
   * Carries the proven facts, so callers never have to re-check invariants
   * this module already established — re-checking is how the rules got
   * duplicated in the first place.
   */
  | {
      readonly kind: 'serve'
      readonly childSessionId: string
      readonly childComposition: typeof LOCUS_SAFE_CHILD_COMPOSITION
    }
  | { readonly kind: 'replace'; readonly reason: string }
  | { readonly kind: 'terminal'; readonly reason: string }

/** The fields any caller can supply; keeps this usable from projections too. */
export interface ServiceabilitySubject {
  readonly state: LocusState
  readonly childSessionId?: string
  readonly childComposition?: string
  readonly invalidReason?: string
}

/**
 * Whether this state records an OWNER decision to take the endpoint out of
 * service. These are terminal for ordinary work by spec.
 */
export function isOwnerExit(state: LocusState): boolean {
  return state === 'stopped' || state === 'retired'
}

/**
 * Whether an unavailable generation may be replaced without owner action.
 *
 * Deliberately the exact complement of {@link isOwnerExit} among the
 * unavailable states: `invalid` is the only one that is a Host judgement
 * rather than an owner decision. Transient states (`provisioning`,
 * `switching`) are not "unavailable" and are excluded by the caller.
 */
export function mayReplaceWithoutOwner(state: LocusState): boolean {
  return state === 'invalid'
}

/**
 * Decide what may be done with one generation.
 *
 * A generation serves work only when it is `active`, has a child session, and
 * carries the durable safe-v1 composition proof. Anything else is classified
 * by WHO made it unavailable, never by which layer happens to be asking.
 * @param subject - the generation's state and composition facts.
 * @returns the disposition every delivery-path layer must agree on.
 */
export function dispositionOf(subject: ServiceabilitySubject): LocusDisposition {
  if (subject.state === 'active') {
    const childSessionId = subject.childSessionId?.trim() ?? ''
    if (childSessionId === '') {
      return { kind: 'replace', reason: 'active generation has no child session' }
    }
    if (subject.childComposition !== LOCUS_SAFE_CHILD_COMPOSITION) {
      // Refusing to SERVE this is what keeps the parent preset from being
      // inherited by a child whose composition cannot be proven. Replacing it
      // is safe: the replacement is created fresh WITH the proof.
      return { kind: 'replace', reason: 'no durable safe-v1 child composition proof' }
    }
    return { kind: 'serve', childSessionId, childComposition: LOCUS_SAFE_CHILD_COMPOSITION }
  }
  if (isOwnerExit(subject.state)) {
    return { kind: 'terminal', reason: `endpoint was explicitly ${subject.state} by its owner` }
  }
  if (mayReplaceWithoutOwner(subject.state)) {
    return {
      kind: 'replace',
      reason: subject.invalidReason === undefined
        ? 'generation was invalidated by the Host'
        : `generation was invalidated by the Host (${subject.invalidReason})`,
    }
  }
  // `provisioning` / `switching`: in flight, not a decision to act on.
  return { kind: 'terminal', reason: `generation is ${subject.state}` }
}
