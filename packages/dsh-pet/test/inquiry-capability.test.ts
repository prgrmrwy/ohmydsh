/**
 * Detector tests for the isolated queued-turn claim capability.
 *
 * Two layers on purpose:
 *  1. Pure injected-seam cases, which pin the discriminated result and prove the
 *     detector fails closed on absent / unknown / throwing seams.
 *  2. The installed 0.1.5 runtime deliberately has no public `Inbox` constructor
 *     export; concrete inbox ownership moved into AgentLoop. The capability is
 *     therefore unavailable until the target-compatible overlay publishes an
 *     explicit marker and a real AgentLoop-backed probe. This test keeps the
 *     negative verdict without inventing a private constructor seam.
 */
import { describe, expect, it } from 'vitest'
import {
  ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED,
  detectIsolatedQueuedTurnClaim,
  type IsolatedClaimProbeFixture,
  type IsolatedClaimProbeObservation,
} from '../src/host/inquiry/capability.js'

/** A driver that owns the behavior, exactly as the patched AgentLoop declares it. */
const capableLoop = { supportsIsolatedQueuedTurnClaim: true }

/** An honest isolated claim: only the head queued turn, `next-step` untouched. */
const isolatingProbe = (fixture: IsolatedClaimProbeFixture): IsolatedClaimProbeObservation => ({
  claimedMessageIds: [fixture.nextTurnId],
  pendingNextStepIds: [fixture.nextStepId],
})

/** The pre-seam runtime: one claim sweeps pending GUI input along with the turn. */
const sweepingProbe = (fixture: IsolatedClaimProbeFixture): IsolatedClaimProbeObservation => ({
  claimedMessageIds: [fixture.nextStepId, fixture.nextTurnId],
  pendingNextStepIds: [],
})

describe('detectIsolatedQueuedTurnClaim marker verification', () => {
  it('reports available only when the marker and the observed claim both hold', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: isolatingProbe,
    })).toEqual({ available: true })
  })

  it('fails closed on absent, null or non-object seams', () => {
    for (const seams of [undefined, null, 'agent-loop', 42, true]) {
      expect(detectIsolatedQueuedTurnClaim(seams)).toEqual({
        available: false,
        reason: 'seams-missing',
      })
    }
  })

  it('fails closed when no driver is supplied to carry the marker', () => {
    expect(detectIsolatedQueuedTurnClaim({ probeIsolatedClaim: isolatingProbe })).toEqual({
      available: false,
      reason: 'agent-loop-missing',
    })
    expect(detectIsolatedQueuedTurnClaim({ agentLoop: null, probeIsolatedClaim: isolatingProbe })).toEqual({
      available: false,
      reason: 'agent-loop-missing',
    })
  })

  it('requires the literal marker and never accepts a truthy stand-in', () => {
    // Each of these is something a caller might mistake for the capability.
    for (const marker of [undefined, false, 'true', 1, {}, [], 'supported']) {
      expect(detectIsolatedQueuedTurnClaim({
        agentLoop: { supportsIsolatedQueuedTurnClaim: marker },
        probeIsolatedClaim: isolatingProbe,
      })).toEqual({ available: false, reason: 'marker-absent' })
    }
  })

  it('does not accept a version string or a config flag as evidence', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: { version: '0.1.2-rc.1-locus-settlement-notice.1', isolateQueuedTurnClaim: true },
      probeIsolatedClaim: isolatingProbe,
    })).toEqual({ available: false, reason: 'marker-absent' })
  })

  it('treats a throwing marker as unreadable rather than as a capability', () => {
    const agentLoop = {
      get supportsIsolatedQueuedTurnClaim(): boolean {
        throw new Error('service disposed')
      },
    }
    expect(detectIsolatedQueuedTurnClaim({ agentLoop, probeIsolatedClaim: isolatingProbe })).toEqual({
      available: false,
      reason: 'marker-unreadable',
    })
  })
})

describe('detectIsolatedQueuedTurnClaim behavioral probe', () => {
  it('refuses to conclude anything without a probe', () => {
    expect(detectIsolatedQueuedTurnClaim({ agentLoop: capableLoop })).toEqual({
      available: false,
      reason: 'probe-missing',
    })
    expect(detectIsolatedQueuedTurnClaim({ agentLoop: capableLoop, probeIsolatedClaim: 'yes' })).toEqual({
      available: false,
      reason: 'probe-missing',
    })
  })

  it('treats a throwing probe as unavailable', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: () => { throw new Error('inbox unavailable') },
    })).toEqual({ available: false, reason: 'probe-threw' })
  })

  it('rejects an unusable probe report instead of reading it optimistically', () => {
    const unusable: unknown[] = [
      undefined,
      null,
      { claimedMessageIds: 'x', pendingNextStepIds: [] },
      { claimedMessageIds: [], pendingNextStepIds: 'x' },
      { claimedMessageIds: [1], pendingNextStepIds: [] },
    ]
    for (const observation of unusable) {
      expect(detectIsolatedQueuedTurnClaim({
        agentLoop: capableLoop,
        probeIsolatedClaim: () => observation as IsolatedClaimProbeObservation,
      })).toEqual({ available: false, reason: 'probe-unusable' })
    }
  })

  it('rejects an extra claimed message even when the queued turn is present', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: fixture => ({
        claimedMessageIds: [fixture.nextTurnId, 'another-queued-turn'],
        pendingNextStepIds: [fixture.nextStepId],
      }),
    })).toEqual({ available: false, reason: 'probe-unusable' })
  })

  it('reports a swept next-step claim as the distinct foreign-input failure', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: sweepingProbe,
    })).toEqual({ available: false, reason: 'probe-swept-foreign-input' })
  })

  it('reports a dropped next-step message as swept, not as a clean isolation', () => {
    // The GUI input is neither claimed nor still pending: it was lost.
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: fixture => ({
        claimedMessageIds: [fixture.nextTurnId],
        pendingNextStepIds: [],
      }),
    })).toEqual({ available: false, reason: 'probe-swept-foreign-input' })
  })

  it('reports an empty claim as a missed queued turn rather than as isolation', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: fixture => ({
        claimedMessageIds: [],
        pendingNextStepIds: [fixture.nextStepId],
      }),
    })).toEqual({ available: false, reason: 'probe-missed-queued-turn' })
  })

  it('owns the fixture identities so a probe cannot answer about its own messages', () => {
    const seen: IsolatedClaimProbeFixture[] = []
    const result = detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: fixture => {
        seen.push(fixture)
        // A probe that reports unrelated identities proves nothing.
        return { claimedMessageIds: ['some-turn'], pendingNextStepIds: ['some-step'] }
      },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.nextStepId).not.toBe(seen[0]!.nextTurnId)
    expect(result).toEqual({ available: false, reason: 'probe-swept-foreign-input' })
  })
})

describe('ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED', () => {
  it('is an unavailable verdict, so an unprobed caller can never be available', () => {
    expect(ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED).toEqual({ available: false, reason: 'not-probed' })
    expect(ISOLATED_QUEUED_TURN_CLAIM_NOT_PROBED.available).toBe(false)
  })
})

describe('detectIsolatedQueuedTurnClaim against the installed runtime', () => {
  it('is unavailable today because the target AgentLoop exposes no marker or probe seam', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: {},
    })).toEqual({ available: false, reason: 'marker-absent' })
  })

  it('does not accept a marker without an explicit behavioral probe', () => {
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
    })).toEqual({ available: false, reason: 'probe-missing' })
  })
})
