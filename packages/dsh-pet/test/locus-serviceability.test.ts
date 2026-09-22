/**
 * The shared serviceability policy.
 *
 * These cases exist because the policy used to be restated in six places
 * across four files, so teaching the channel to recover a Host-invalidated
 * generation took three rounds of fixes — each one only moving the refusal
 * one layer deeper. The full state table is pinned here so a future state
 * cannot be added without an explicit decision, and every delivery-path layer
 * can be checked against ONE source.
 */
import { describe, expect, it } from 'vitest'
import type { LocusState } from '../src/host/locus/aggregate.js'
import {
  dispositionOf,
  isOwnerExit,
  mayReplaceWithoutOwner,
} from '../src/host/locus/serviceability.js'

const ALL_STATES: readonly LocusState[] = [
  'provisioning',
  'active',
  'switching',
  'invalid',
  'retired',
  'stopped',
]

const serve = { state: 'active' as const, childSessionId: 'child-1', childComposition: 'safe-v1' as const }

describe('locus serviceability policy', () => {
  it('serves an active generation that carries the safe-v1 proof', () => {
    expect(dispositionOf(serve)).toEqual({
      kind: 'serve',
      childSessionId: 'child-1',
      childComposition: 'safe-v1',
    })
  })

  // The replacement is only ever a NEW generation: serving this one would let
  // a child whose composition cannot be proven inherit the parent preset.
  it('offers replacement, never service, for an active generation without the proof', () => {
    expect(dispositionOf({ ...serve, childComposition: undefined })).toMatchObject({
      kind: 'replace',
      reason: expect.stringContaining('safe-v1'),
    })
    expect(dispositionOf({ state: 'active', childComposition: 'safe-v1' })).toMatchObject({
      kind: 'replace',
      reason: expect.stringContaining('child session'),
    })
  })

  // The distinction the whole three-round bug hinged on: an owner exit is
  // terminal, a Host judgement is replaceable.
  it('treats an owner exit as terminal and a Host invalidation as replaceable', () => {
    expect(dispositionOf({ state: 'stopped' })).toMatchObject({ kind: 'terminal' })
    expect(dispositionOf({ state: 'retired' })).toMatchObject({ kind: 'terminal' })
    expect(dispositionOf({ state: 'invalid', invalidReason: '子会话已不存在' })).toMatchObject({
      kind: 'replace',
      reason: expect.stringContaining('子会话已不存在'),
    })
  })

  it('carries the stored reason into the Host-invalidation diagnosis', () => {
    // Operators need the original text: a bare code cannot distinguish a
    // transient re-attach race from a genuinely unusable child.
    expect(dispositionOf({ state: 'invalid', invalidReason: 'x' }).kind).toBe('replace')
    expect(dispositionOf({ state: 'invalid' })).toMatchObject({
      reason: expect.stringContaining('Host'),
    })
  })

  it('keeps in-flight states terminal for ordinary work', () => {
    expect(dispositionOf({ state: 'provisioning' })).toMatchObject({ kind: 'terminal' })
    expect(dispositionOf({ state: 'switching' })).toMatchObject({ kind: 'terminal' })
  })

  // Adding a state must be a deliberate act: this table is what makes the
  // compiler's silence insufficient and forces the decision to be recorded.
  it('classifies every known state exactly once', () => {
    const expected: Record<LocusState, 'serve' | 'replace' | 'terminal'> = {
      active: 'serve',
      invalid: 'replace',
      stopped: 'terminal',
      retired: 'terminal',
      provisioning: 'terminal',
      switching: 'terminal',
    }
    for (const state of ALL_STATES) {
      expect(dispositionOf({ ...serve, state }).kind).toBe(expected[state])
    }
    expect(Object.keys(expected).sort()).toEqual([...ALL_STATES].sort())
  })

  it('agrees with the owner-exit / replaceable split', () => {
    for (const state of ALL_STATES) {
      // The two predicates partition the unavailable states; neither may
      // silently grow to cover the other's territory.
      expect(isOwnerExit(state) && mayReplaceWithoutOwner(state)).toBe(false)
    }
    expect(ALL_STATES.filter(isOwnerExit)).toEqual(['retired', 'stopped'])
    expect(ALL_STATES.filter(mayReplaceWithoutOwner)).toEqual(['invalid'])
  })
})
