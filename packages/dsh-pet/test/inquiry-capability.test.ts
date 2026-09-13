/**
 * Detector tests for the isolated queued-turn claim capability.
 *
 * Two layers on purpose:
 *  1. Pure injected-seam cases, which pin the discriminated result and prove the
 *     detector fails closed on absent / unknown / throwing seams.
 *  2. One case driven by the ACTUALLY INSTALLED `@deepseek-ai/dsh-agent` Inbox.
 *     The seam exists only in the tracked compat patch and has NOT been built,
 *     so the installed runtime still sweeps pending `next-step` input. That is
 *     the path that must work today, so it is exercised against the real class
 *     rather than a hand-written lookalike.
 *
 * If a rebuilt runtime ever ships the seam, the real-Inbox case below MUST fail.
 * That failure is the signal to re-verify the capability deliberately, not a
 * reason to loosen the detector.
 */
import { describe, expect, it } from 'vitest'
import { Inbox } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
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

describe('detectIsolatedQueuedTurnClaim against the installed runtime Inbox', () => {
  const message = (id: string): UserMessage => ({
    id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'user' },
  } as UserMessage)

  /** In-memory append sink; NOT a Session, no persistence, no agent, no model. */
  function realInboxProbe(fixture: IsolatedClaimProbeFixture): IsolatedClaimProbeObservation {
    const events: { type: string; data: unknown; seq: number }[] = []
    const sink = {
      ownEvents: () => events,
      append(type: string, data: unknown) {
        const event = { type, data, seq: events.length }
        events.push(event)
        return event
      },
    }
    const inbox = new Inbox(sink as never, { inserted() {}, discarded() {}, claimed() {} })
    inbox.append('next-step', message(fixture.nextStepId))
    inbox.append('next-turn', message(fixture.nextTurnId))
    // The opt-in option is passed exactly as the patched seam defines it. An
    // unpatched build accepts the extra argument silently and ignores it.
    const claimed = (inbox.claim as (
      target: 'next-turn', turn: number, options?: { isolateQueuedTurn?: boolean },
    ) => UserMessage[])('next-turn', 1, { isolateQueuedTurn: true })
    return {
      claimedMessageIds: claimed.map(value => String(value.id)),
      pendingNextStepIds: inbox.nextStep.map(value => String(value.id)),
    }
  }

  it('is unavailable today: the installed build has no marker at all', () => {
    // No AgentLoop marker is supplied because the installed loop does not declare
    // one. This is the verdict the Host actually gets right now.
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: {},
      probeIsolatedClaim: realInboxProbe,
    })).toEqual({ available: false, reason: 'marker-absent' })
  })

  it('stays unavailable even if a marker were present, because the real claim still sweeps GUI input', () => {
    // This is the delivery gap recorded in the capability audit: a patched loop
    // paired with an unpatched dsh-agent. A marker alone is NOT the capability.
    expect(detectIsolatedQueuedTurnClaim({
      agentLoop: capableLoop,
      probeIsolatedClaim: realInboxProbe,
    })).toEqual({ available: false, reason: 'probe-swept-foreign-input' })
  })
})
