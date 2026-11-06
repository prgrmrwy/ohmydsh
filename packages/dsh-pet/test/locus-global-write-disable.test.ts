import { describe, expect, it, vi } from 'vitest'
import {
  classifyLocusCompositionFailure,
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_SAFE_TOOL_NAMES,
  LocusCompositionError,
  type LocusChildComposition,
} from '../src/host/locus/composition.js'
import type { LocusAccessModeV20 } from '../src/host/locus/contract-v20.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import {
  LOCUS_WRITE_DISABLED_DIAGNOSTIC,
  verifyLocusLivePolicy,
  verifyLocusPersistedPolicy,
} from '../src/host/locus/policy-verification.js'

/** A cold publication with LOCUS_WRITE_ENABLED off (D8). */
function world(accessMode: LocusAccessModeV20) {
  const composition: LocusChildComposition = {
    locusId: 'locus', sessionId: 'child', revision: 1, locusMainSessionId: 'main',
    accessMode, endpoint: { chatId: 'oc_1' },
  }
  const applied: LocusAccessModeV20[] = []
  const apply = vi.fn((_id: string, mode: LocusAccessModeV20) => { applied.push(mode) })
  const resolve = vi.fn(() => applied.at(-1))
  const install = vi.fn()
  const run = () => composeLocusChild({ id: 'child', scope: { get: () => ({}) } }, {
    lookup: { find: () => composition }, parentPreset: () => LOCUS_BASE_PRESET, childPreset: () => 'locus-child', writeEnabled: false,
    surface: {
      install, applyAccessMode() {}, installOutboundGuard() {},
      visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS],
    },
    policy: { apply, resolve },
  })
  return { composition, applied, install, run }
}

describe('global write disable at cold child publication (v20)', () => {
  it('refuses a stored danger-full-access row instead of demoting it, and leaves the row as the owner set it', () => {
    const w = world('danger-full-access')
    let error: unknown
    try { w.run() } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(LocusCompositionError)
    expect((error as LocusCompositionError).reason).toBe('write-disabled')
    expect((error as Error).message).toBe(LOCUS_WRITE_DISABLED_DIAGNOSTIC)
    expect(classifyLocusCompositionFailure(error)).toBe('B')
    // Nothing was served as read-only: no sandbox applied, no surface installed.
    expect(w.applied).toEqual([])
    expect(w.install).not.toHaveBeenCalled()
    expect(w.composition.accessMode).toBe('danger-full-access')
  })

  it('still composes a read-only row while the switch is off', () => {
    const w = world('read-only')
    expect(w.run()).toMatchObject({ composed: true, accessMode: 'read-only' })
    expect(w.applied).toEqual(['read-only'])
  })

  it('refuses a released full-access entry at delivery time while the switch is off (no derived read)', () => {
    expect(verifyLocusPersistedPolicy({ accessMode: 'danger-full-access' }, false))
      .toMatchObject({ ok: false, reason: 'write-disabled', diagnostic: LOCUS_WRITE_DISABLED_DIAGNOSTIC })
    expect(verifyLocusPersistedPolicy({ accessMode: 'read-only' }, false)).toEqual({ ok: true, effective: 'read-only' })
  })

  it('refuses a live full-access child whatever the live sandbox reports', () => {
    for (const mode of ['danger-full-access', 'read-only']) {
      expect(verifyLocusLivePolicy({ accessMode: 'danger-full-access' }, { mode }, false))
        .toMatchObject({ ok: false, reason: 'write-disabled' })
    }
  })
})
