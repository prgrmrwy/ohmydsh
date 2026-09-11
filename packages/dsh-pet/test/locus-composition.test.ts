import { describe, expect, it, vi } from 'vitest'
import {
  composeLocusChild,
  LocusCompositionError,
  type LocusChildComposition,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'

const CHILD = 'child-1'

function composition(
  overrides: Partial<LocusChildComposition> = {},
): LocusChildComposition {
  return {
    parentSessionId: 'main-1',
    childSessionId: CHILD,
    locusId: 'locus-1',
    generation: 2,
    permission: 'read',
    ...overrides,
  }
}

function agent(sessionId = CHILD) {
  return { sessionId, scope: { get: vi.fn(() => ({})) } }
}

function ports(
  overrides: Partial<LocusCompositionPorts> = {},
): LocusCompositionPorts {
  const applied = new Map<string, 'read' | 'write'>()
  return {
    lookup: { find: vi.fn(() => composition()) },
    surface: { install: vi.fn() },
    policy: {
      apply: vi.fn((sessionId: string, permission: 'read' | 'write') => {
        applied.set(sessionId, permission)
      }),
      resolve: vi.fn((sessionId: string) => applied.get(sessionId)),
    },
    ...overrides,
  }
}

describe('unified locus child composition', () => {
  it('installs the caller-bound surface on the child scope and verifies read policy', () => {
    const deps = ports()
    const candidate = agent()

    const result = composeLocusChild(candidate, deps)

    expect(result).toEqual({
      composed: true,
      composition: composition(),
      effectivePermission: 'read',
    })
    // Registered against the child's OWN scope object: installing on the Host
    // scope would publish the surface globally instead of binding it here.
    expect(deps.surface?.install).toHaveBeenCalledWith(candidate)
    expect(deps.policy?.apply).toHaveBeenCalledWith(CHILD, 'read')
  })

  it('leaves an ordinary session untouched', () => {
    const deps = ports({ lookup: { find: vi.fn(() => undefined) } })

    expect(composeLocusChild(agent('ordinary'), deps)).toEqual({ composed: false })
    expect(deps.surface?.install).not.toHaveBeenCalled()
    expect(deps.policy?.apply).not.toHaveBeenCalled()
  })

  it('refuses to publish a locus child when the Host has no surface or policy seam', () => {
    for (const [missing, reason] of [
      ['surface', 'surface-unavailable'],
      ['policy', 'policy-unavailable'],
    ] as const) {
      const deps = ports({ [missing]: undefined })
      // Throwing is the point: at the synchronous creation boundary it vetoes
      // publication, so no child ever runs a turn without its surface.
      expect(() => composeLocusChild(agent(), deps)).toThrow(LocusCompositionError)
      try {
        composeLocusChild(agent(), deps)
      } catch (error) {
        expect((error as LocusCompositionError).reason).toBe(reason)
      }
    }
  })

  it('refuses when the resolved policy does not match the locus grant', () => {
    // A locus granted read must not run on a write scope, and a locus granted
    // write must not silently degrade to read either.
    for (const [granted, resolved] of [['read', 'write'], ['write', 'read']] as const) {
      const deps = ports({
        lookup: { find: vi.fn(() => composition({ permission: granted })) },
        policy: { apply: vi.fn(), resolve: vi.fn(() => resolved) },
      })

      try {
        composeLocusChild(agent(), deps)
        expect.unreachable('composition must refuse an unverified policy')
      } catch (error) {
        expect((error as LocusCompositionError).reason).toBe('policy-not-verified')
      }
    }
  })

  it('refuses when the Host resolves no policy at all', () => {
    const deps = ports({ policy: { apply: vi.fn(), resolve: vi.fn(() => undefined) } })

    try {
      composeLocusChild(agent(), deps)
      expect.unreachable('composition must refuse an unresolvable policy')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('policy-not-verified')
      expect((error as Error).message).toContain('no policy')
    }
  })

  it('applies policy before installing the surface', () => {
    const order: string[] = []
    const deps = ports({
      surface: { install: vi.fn(() => { order.push('surface') }) },
      policy: {
        apply: vi.fn(() => { order.push('policy') }),
        resolve: vi.fn(() => 'read' as const),
      },
    })

    composeLocysChildSafely(deps)
    // The child must never observe a surface that outlived a failed policy.
    expect(order).toEqual(['policy', 'surface'])
  })

  it('reports a failing surface or policy application without publishing', () => {
    const surfaceFailure = ports({
      surface: { install: vi.fn(() => { throw new Error('tools unavailable') }) },
    })
    try {
      composeLocusChild(agent(), surfaceFailure)
      expect.unreachable('a failing surface must not publish the child')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('surface-failed')
      expect((error as Error).cause).toBeInstanceOf(Error)
    }

    const policyFailure = ports({
      policy: {
        apply: vi.fn(() => { throw new Error('sandbox rejected') }),
        resolve: vi.fn(() => 'read' as const),
      },
    })
    try {
      composeLocusChild(agent(), policyFailure)
      expect.unreachable('a failing policy must not publish the child')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('policy-failed')
    }
  })

  it('refuses an unusable lookup or a mismatched child identity', () => {
    const broken = ports({
      lookup: { find: vi.fn(() => { throw new Error('store unavailable') }) },
    })
    try {
      composeLocusChild(agent(), broken)
      expect.unreachable('an unusable lookup cannot prove this is an ordinary session')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('lookup-failed')
    }

    const mismatched = ports({
      lookup: { find: vi.fn(() => composition({ childSessionId: 'child-other' })) },
    })
    try {
      composeLocusChild(agent(), mismatched)
      expect.unreachable('a foreign child identity must never be composed')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('lookup-failed')
    }
  })

  it('composes a verified write locus', () => {
    const applied = new Map<string, 'read' | 'write'>()
    const deps = ports({
      lookup: { find: vi.fn(() => composition({ permission: 'write' })) },
      policy: {
        apply: vi.fn((sessionId: string, permission: 'read' | 'write') => {
          applied.set(sessionId, permission)
        }),
        resolve: vi.fn((sessionId: string) => applied.get(sessionId)),
      },
    })

    expect(composeLocusChild(agent(), deps)).toMatchObject({
      composed: true,
      effectivePermission: 'write',
    })
  })
})

/** Compose with a fixture whose policy resolves the granted permission. */
function composeLocysChildSafely(deps: LocusCompositionPorts): void {
  composeLocusChild(agent(), deps)
}
