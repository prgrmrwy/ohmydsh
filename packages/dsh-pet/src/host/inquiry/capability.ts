/**
 * Detector for the runtime's ISOLATED QUEUED-TURN CLAIM capability.
 *
 * WHY THIS EXISTS
 *
 * `Inbox.claim('next-turn', turn)` is a pure deletion. The default claim takes
 * every pending `next-step` message together with the head queued turn, and
 * there is no undo path. So a Host that discovers a mixed batch after the fact
 * has only bad options: run an inquiry turn contaminated with the user's GUI
 * input, or refuse the segment and destroy input that can never be re-delivered.
 *
 * The tracked compat patch adds a narrow opt-in seam that lets the caller choose
 * the scope BEFORE the deletion:
 *
 *   - `Inbox.claim(target, turn, { isolateQueuedTurn: true })`
 *   - `AgentOptions.isolateQueuedTurnClaim`
 *   - `AgentLoop.supportsIsolatedQueuedTurnClaim === true`
 *
 * An OLDER loop silently ignores the unknown option and claims the combined
 * batch anyway. Silence is therefore indistinguishable from success at the call
 * site, which is exactly why the capability must be PROVEN before an inquiry is
 * dispatched rather than assumed from a version, a config flag or a patch file.
 *
 * WHAT THIS MODULE VERIFIES
 *
 * Two independent facts, both required:
 *
 *  1. The driver DECLARES ownership of the behavior (the literal marker).
 *  2. An actual claim OBSERVABLY isolated: the head queued turn was claimed and
 *     the pending `next-step` message was left pending, untouched.
 *
 * Fact 1 alone is not enough. The capability audit records a real delivery gap
 * where a patched `dsh-agent-loop` resolved against an UNPATCHED `dsh-agent`,
 * so the marker was present while the claim still swept GUI input.
 *
 * WHAT THIS MODULE IS NOT
 *
 * - It is not an installer or a negotiator. It reports, it never enables.
 * - It imports nothing from DSH. The caller injects the driver and a probe, so
 *   this file never learns about Cordis services, Inbox internals or versions.
 * - It performs no I/O and keeps no state: every call re-derives its verdict.
 *
 * CONSTRAINTS
 *
 * Absent, unknown, unreadable, malformed and throwing inputs all produce an
 * UNAVAILABLE verdict. There is no path from uncertainty to `available: true`.
 */

/**
 * Why the isolated queued-turn claim is not usable. Stable and machine-readable
 * so a caller can explain the refusal without echoing runtime internals.
 */
export type IsolatedQueuedTurnClaimUnavailableReason =
  /** No detection has run yet. The safe default for any unprobed caller. */
  | 'not-probed'
  /** The seams argument itself was absent or not an object. */
  | 'seams-missing'
  /** No driver was supplied to carry the capability marker. */
  | 'agent-loop-missing'
  /** The driver does not declare `supportsIsolatedQueuedTurnClaim === true`. */
  | 'marker-absent'
  /** Reading the marker threw; an unreadable driver proves nothing. */
  | 'marker-unreadable'
  /** No behavioral probe was supplied, so the marker could not be corroborated. */
  | 'probe-missing'
  /** The probe threw instead of reporting an observation. */
  | 'probe-threw'
  /** The probe returned something this detector cannot interpret. */
  | 'probe-unusable'
  /** The probe's claim consumed or dropped the pending `next-step` input. */
  | 'probe-swept-foreign-input'
  /** The probe left `next-step` alone but failed to claim the queued turn. */
  | 'probe-missed-queued-turn'

/** Discriminated verdict. Callers branch on `available`, never on a string. */
export type IsolatedQueuedTurnClaimSupport =
  | { readonly available: true }
  | {
      readonly available: false
      readonly reason: IsolatedQueuedTurnClaimUnavailableReason
    }

/**
 * The verdict for a caller that has not probed. Exported as a constant so a
 * default can never accidentally be written as "available until proven absent".
 */
export const ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED: IsolatedQueuedTurnClaimSupport = Object.freeze({
  available: false,
  reason: 'not-probed' as const,
})

/**
 * Identities this detector owns for one probe.
 *
 * The detector chooses them so the probe can only answer about the exact two
 * messages under test; a report about unrelated identities proves nothing and is
 * treated as a failure.
 */
export interface IsolatedClaimProbeFixture {
  /** A pending GUI-style `next-step` message that MUST survive the claim. */
  readonly nextStepId: string
  /** The head queued `next-turn` message that MUST be the whole claim. */
  readonly nextTurnId: string
}

/** What the probe observed after performing one isolated claim. */
export interface IsolatedClaimProbeObservation {
  /** Message ids the claim actually returned, in claim order. */
  readonly claimedMessageIds: readonly string[]
  /** Message ids still pending on `next-step` after the claim. */
  readonly pendingNextStepIds: readonly string[]
}

/**
 * Runtime seams the caller injects.
 *
 * Deliberately structural: anything with the right shape can be supplied, which
 * keeps this module free of DSH imports and lets the caller decide how the probe
 * builds its throwaway Inbox.
 */
export interface IsolatedQueuedTurnClaimSeams {
  /** The agent driver expected to declare ownership of the isolated claim. */
  readonly agentLoop?: unknown
  /**
   * Perform ONE isolated claim on a throwaway inbox and report what happened.
   * It must not touch a live agent, a real session or durable storage.
   */
  readonly probeIsolatedClaim?: unknown
}

/**
 * Fixed, self-describing probe identities.
 *
 * Constant rather than generated: the detector must be replayable, and the only
 * property the verification relies on is that the two ids differ.
 */
const PROBE_FIXTURE: IsolatedClaimProbeFixture = Object.freeze({
  nextStepId: 'dsh-pet-probe-next-step',
  nextTurnId: 'dsh-pet-probe-next-turn',
})

const unavailable = (
  reason: IsolatedQueuedTurnClaimUnavailableReason,
): IsolatedQueuedTurnClaimSupport => ({ available: false, reason })

const AVAILABLE: IsolatedQueuedTurnClaimSupport = { available: true }

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index])
}

/**
 * Decide whether isolated queued-turn claiming is ACTUALLY available.
 *
 * The two checks are ordered marker-first because the marker is the cheap,
 * side-effect-free one: an unpatched driver is rejected without constructing a
 * probe inbox at all.
 *
 * @param seams - injected driver and probe; anything else fails closed.
 * @returns a discriminated verdict that explains an unavailable capability.
 */
export function detectIsolatedQueuedTurnClaim(seams: unknown): IsolatedQueuedTurnClaimSupport {
  if (seams === null || typeof seams !== 'object') return unavailable('seams-missing')
  const { agentLoop, probeIsolatedClaim } = seams as IsolatedQueuedTurnClaimSeams

  // ---- fact 1: the driver declares it owns the behavior ---------------------
  if (agentLoop === null || agentLoop === undefined) return unavailable('agent-loop-missing')
  if (typeof agentLoop !== 'object' && typeof agentLoop !== 'function') {
    return unavailable('agent-loop-missing')
  }
  let marker: unknown
  try {
    marker = (agentLoop as { supportsIsolatedQueuedTurnClaim?: unknown }).supportsIsolatedQueuedTurnClaim
  } catch {
    // A disposed service or a throwing accessor is not evidence of anything.
    return unavailable('marker-unreadable')
  }
  // Strictly the literal marker. A truthy stand-in, a version string or a
  // config flag would let an unpatched runtime pass as capable.
  if (marker !== true) return unavailable('marker-absent')

  // ---- fact 2: an actual claim observably isolated ---------------------------
  if (typeof probeIsolatedClaim !== 'function') return unavailable('probe-missing')
  let observation: unknown
  try {
    observation = (probeIsolatedClaim as (
      fixture: IsolatedClaimProbeFixture,
    ) => unknown)(PROBE_FIXTURE)
  } catch {
    return unavailable('probe-threw')
  }
  if (observation === null || typeof observation !== 'object') return unavailable('probe-unusable')
  const { claimedMessageIds, pendingNextStepIds } = observation as IsolatedClaimProbeObservation
  if (!isStringArray(claimedMessageIds) || !isStringArray(pendingNextStepIds)) {
    return unavailable('probe-unusable')
  }

  // The load-bearing assertion: the foreign input is EXACTLY as it was. Checked
  // first because a swept or dropped `next-step` is the specific harm this
  // capability exists to prevent, and it is the fact a caller must report.
  if (!sameIds(pendingNextStepIds, [PROBE_FIXTURE.nextStepId])) {
    return unavailable('probe-swept-foreign-input')
  }
  // A claim that isolates by claiming nothing would end the turn and strand the
  // queued inquiry, so it is a distinct failure rather than a success.
  if (claimedMessageIds.length === 0) return unavailable('probe-missed-queued-turn')
  if (!sameIds(claimedMessageIds, [PROBE_FIXTURE.nextTurnId])) return unavailable('probe-unusable')
  return AVAILABLE
}
