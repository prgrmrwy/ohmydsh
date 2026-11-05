import { describe, expect, it, vi } from 'vitest'
import { composeLocusChild, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES, type LocusChildComposition, type LocusChildPermission } from '../src/host/locus/composition.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'
import { verifyLocusPersistedPolicy } from '../src/host/locus/policy-verification.js'

function world(pendingPermission?: LocusChildPermission) {
  const composition: LocusChildComposition = {
    locusId: 'locus', generation: 1, revision: 1,
    parentSessionId: 'main', childSessionId: 'child',
    childComposition: 'tier3', permission: 'write',
    ...(pendingPermission === undefined ? {} : { pendingPermission }),
  }
  const applied: LocusChildPermission[] = []
  const apply = vi.fn((_id: string, permission: LocusChildPermission) => { applied.push(permission) })
  const resolve = vi.fn(() => applied.at(-1))
  const run = () => composeLocusChild({ id: 'child', scope: {} }, {
    lookup: { find: () => composition }, parentPreset: () => LOCUS_BASE_PRESET, childPreset: () => 'locus-child', writeEnabled: false,
    surface: {
      install() {}, setToolTier() {}, installOutboundGuard() {},
      visibleTools: () => [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS],
    },
    policy: { apply, resolve },
  })
  return { composition, applied, resolve, run }
}

describe('global write disable at cold child publication', () => {
  it('applies and verifies read for a stored write grant without rewriting owner intent', () => {
    const w = world()
    expect(w.run()).toMatchObject({ composed: true, effectivePermission: 'read' })
    expect(w.applied).toEqual(['read'])
    expect(w.composition.permission).toBe('write')
  })

  it('never restores write when a pending revoke cannot verify read', () => {
    const w = world('read')
    w.resolve.mockReturnValue('write')
    expect(w.run).toThrow()
    expect(w.applied.length).toBeGreaterThan(0)
    expect(w.applied.every(value => value === 'read')).toBe(true)
  })

  it('admits a released verified write entry under derived read while the switch is off', () => {
    expect(verifyLocusPersistedPolicy({
      permission: { desired: 'write', effective: 'write', verifiedAt: 1, grantedBy: 'owner' },
    }, false)).toEqual({ ok: true, effective: 'read' })
  })

  it('still refuses a stored write grant with no original verification proof', () => {
    expect(verifyLocusPersistedPolicy({
      permission: { desired: 'write', effective: 'write' },
    }, false)).toMatchObject({ ok: false, reason: 'permission-unverified' })
  })
})
