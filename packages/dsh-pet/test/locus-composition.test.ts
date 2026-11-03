import { describe, expect, it, vi } from 'vitest'
import {
  attestLocusComposition,
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_DELEGATION_DENYLIST,
  LOCUS_SAFE_TOOL_NAMES,
  LOCUS_SHELL_TIER_TOOL_NAMES,
  LocusCompositionError,
  type LocusChildComposition,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'

const CHILD = 'child-1'

/** The reviewed surface a composed child is expected to expose. */
const SAFE_SURFACE: readonly string[] = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS]

function composition(
  overrides: Partial<LocusChildComposition> = {},
): LocusChildComposition {
  return {
    parentSessionId: 'main-1',
    childSessionId: CHILD,
    locusId: 'locus-1',
    generation: 2,
    permission: 'read',
    childComposition: 'tier3',
    toolTier: { desired: 'safe', effective: 'safe' },
    ...overrides,
  }
}

/** A complete surface seam: tier layer, outbound guard and a readable safe surface. */
function surface(overrides: Partial<NonNullable<LocusCompositionPorts['surface']>> = {}) {
  return {
    install: vi.fn(),
    setToolTier: vi.fn(),
    installOutboundGuard: vi.fn(),
    visibleTools: vi.fn(() => SAFE_SURFACE),
    ...overrides,
  }
}

function agent(id = CHILD) {
  return { id, scope: { get: vi.fn(() => ({})) } }
}

function ports(
  overrides: Partial<LocusCompositionPorts> = {},
): LocusCompositionPorts {
  const applied = new Map<string, 'read' | 'write'>()
  return {
    lookup: { find: vi.fn(() => composition()) },
    parentPreset: vi.fn(() => LOCUS_BASE_PRESET),
    writeEnabled: true,
    surface: surface(),
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
    expect(deps.surface?.install).toHaveBeenCalledWith(candidate, composition())
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
      surface: surface({ install: vi.fn(() => { order.push('surface') }) }),
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
      surface: surface({ install: vi.fn(() => { throw new Error('tools unavailable') }) }),
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

describe('locus composition attestation', () => {
  it('accepts the unchanged safe surface and the explicit shell surface', () => {
    expect(attestLocusComposition(SAFE_SURFACE)).toEqual({ ok: true, leaks: [] })
    expect(attestLocusComposition([...SAFE_SURFACE, ...LOCUS_SHELL_TIER_TOOL_NAMES], 'shell'))
      .toEqual({ ok: true, leaks: [] })
    // Order and repetition carry no meaning; only membership does.
    expect(attestLocusComposition([...SAFE_SURFACE].reverse().concat('read')).ok).toBe(true)
  })

  it('names tools outside the selected tier and every delegation route', () => {
    expect(attestLocusComposition([...SAFE_SURFACE, 'subagent'])).toEqual({
      ok: false,
      reason: 'leaked',
      leaks: ['subagent'],
    })
    expect(attestLocusComposition([...SAFE_SURFACE, 'bash'])).toMatchObject({
      ok: false,
      reason: 'leaked',
      leaks: ['bash'],
    })
    expect(attestLocusComposition(['bash', 'subagent', 'bash'], 'shell')).toMatchObject({
      ok: false,
      reason: 'leaked',
      leaks: ['subagent'],
    })
    expect(attestLocusComposition([...SAFE_SURFACE, 'workflow'])).toMatchObject({
      ok: false,
      leaks: ['workflow'],
    })
    expect(LOCUS_DELEGATION_DENYLIST).toContain('subagent')
    expect(LOCUS_DELEGATION_DENYLIST).toContain('send_message')
  })

  it('requires bash to be visible in shell tier', () => {
    expect(attestLocusComposition(SAFE_SURFACE, 'shell')).toMatchObject({
      ok: false,
      reason: 'leaked',
      leaks: ['bash (required for shell tier)'],
    })
  })

  it('refuses a surface it cannot read instead of treating silence as a pass', () => {
    expect(attestLocusComposition(undefined)).toEqual({
      ok: false,
      reason: 'unreadable',
      leaks: [],
    })
  })
})

describe('unified locus child publication', () => {
  it('收紧层未安装时不发布', () => {
    // No restriction installer at all, and one that throws: both leave the
    // child on the wide persistent base, which must never be published.
    for (const broken of [
      surface({ setToolTier: undefined }),
      surface({ setToolTier: vi.fn(() => { throw new Error('tools.restrict is unavailable') }) }),
    ]) {
      const deps = ports({ surface: broken })
      try {
        composeLocusChild(agent(), deps)
        expect.unreachable('a child without its tier layer must not be published')
      } catch (error) {
        expect(error).toBeInstanceOf(LocusCompositionError)
        expect((error as LocusCompositionError).reason).toBe('surface-not-attested')
      }
    }

    // The layer was "installed" but the readback still shows the wide base.
    const stillWide = ports({ surface: surface({ visibleTools: vi.fn(() => [...SAFE_SURFACE, 'bash']) }) })
    try {
      composeLocusChild(agent(), stillWide)
      expect.unreachable('a safe-tier child that still exposes bash must not be published')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('surface-not-attested')
      expect((error as Error).message).toContain('bash')
    }
  })

  it('requires the outbound guard before any child may publish', () => {
    const deps = ports({ surface: surface({ installOutboundGuard: undefined }) })
    expect(() => composeLocusChild(agent(), deps)).toThrow(LocusCompositionError)
  })

  it('applies the safe restriction before reading the fresh staging surface', () => {
    const visible = [...SAFE_SURFACE, ...LOCUS_SHELL_TIER_TOOL_NAMES]
    const setToolTier = vi.fn((_agent, tier) => {
      expect(tier).toBe('safe')
      // A real restriction removes the shell tools from the visible surface.
      visible.splice(visible.indexOf('bash'), 1)
      visible.splice(visible.indexOf('skill'), 1)
    })
    const deps = ports({ surface: surface({ setToolTier, visibleTools: vi.fn(() => visible) }) })

    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true })
    expect(setToolTier).toHaveBeenCalledOnce()
  })

  it('隔离能力无法证明时不发布', () => {
    // The locus main's preset cannot be proven: no reader, a reader that throws,
    // and a reader that reports nothing are all "unproven", never "assumed fine".
    const noReader = ports()
    const unreadable = ports({ parentPreset: vi.fn(() => { throw new Error('session gone') }) })
    const silent = ports({ parentPreset: vi.fn(() => undefined) })
    for (const deps of [{ ...noReader, parentPreset: undefined }, unreadable, silent]) {
      try {
        composeLocusChild(agent(), deps)
        expect.unreachable('an unprovable parent composition must not publish a child')
      } catch (error) {
        expect((error as LocusCompositionError).reason).toBe('preset-unverified')
      }
      // Refused BEFORE any side effect.
      expect(deps.surface?.install).not.toHaveBeenCalled()
      expect(deps.policy?.apply).not.toHaveBeenCalled()
    }
  })

  it('主会话 preset 不影响子会话工具面', () => {
    // The user's work main runs `standard`, which registers delegation into the
    // agent's own scope. It is not the child's parent, so only the locus main's
    // preset (`locus-base`) and the child's own readback decide the surface.
    const workMainPreset = 'standard'
    const presets = new Map([['main-locus', LOCUS_BASE_PRESET], ['main-work', workMainPreset]])
    const deps = ports({
      lookup: { find: vi.fn(() => composition({ parentSessionId: 'main-locus' })) },
      parentPreset: vi.fn((id: string) => presets.get(id)),
    })

    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true })
    expect(deps.parentPreset).toHaveBeenCalledWith('main-locus')
    expect(deps.parentPreset).not.toHaveBeenCalledWith('main-work')
    // A child that did land under a non-pinned parent is refused, whatever it exposes.
    const wrongParent = ports({
      lookup: { find: vi.fn(() => composition({ parentSessionId: 'main-work' })) },
      parentPreset: vi.fn((id: string) => presets.get(id)),
    })
    try {
      composeLocusChild(agent(), wrongParent)
      expect.unreachable('a child under a non-pinned preset must not be published')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('preset-mismatch')
    }
  })

  it('冷恢复不回落到父组合', () => {
    // Cold resume reaches `agent/created` through the durable lookup. The tier
    // layer is installed again from the persisted tier and verified before the
    // child serves; a locus main that left the pinned preset refuses dispatch.
    const persisted = composition({ toolTier: { desired: 'shell', effective: 'shell' } })
    const setToolTier = vi.fn()
    const resumed = ports({
      lookup: { find: vi.fn(() => persisted) },
      surface: surface({
        setToolTier,
        visibleTools: vi.fn(() => [...SAFE_SURFACE, ...LOCUS_SHELL_TIER_TOOL_NAMES]),
      }),
    })
    expect(composeLocusChild(agent(), resumed)).toMatchObject({ composed: true })
    expect(setToolTier).toHaveBeenCalledWith(expect.anything(), 'shell')

    const drifted = ports({
      lookup: { find: vi.fn(() => persisted) },
      parentPreset: vi.fn(() => 'standard'),
    })
    try {
      composeLocusChild(agent(), drifted)
      expect.unreachable('a resumed child must not serve under a drifted parent preset')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('preset-mismatch')
    }
    expect(drifted.surface?.install).not.toHaveBeenCalled()
  })

  it('safe-v1 行继续服务', () => {
    // Per the spec this row belongs to the retired model: it is NOT served, and
    // not composed, adopted or resumed. (The scenario title predates the rule.)
    for (const childComposition of ['safe-v1', 'safe-v2'] as const) {
      const deps = ports({ lookup: { find: vi.fn(() => composition({ childComposition })) } })
      try {
        composeLocusChild(agent(), deps)
        expect.unreachable(`a ${childComposition} row must not be served`)
      } catch (error) {
        expect((error as LocusCompositionError).reason).toBe('legacy-composition')
      }
      expect(deps.surface?.install).not.toHaveBeenCalled()
      expect(deps.policy?.apply).not.toHaveBeenCalled()
    }
  })

  it('升级前的 legacy child 不可恢复服务', () => {
    const { childComposition: _marker, ...unmarked } = composition()
    const deps = ports({ lookup: { find: vi.fn(() => unmarked) } })
    try {
      composeLocusChild(agent(), deps)
      expect.unreachable('a child without a Host-attested marker must not be resumed')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('legacy-composition')
    }
    expect(deps.surface?.install).not.toHaveBeenCalled()
  })

  it('refuses to publish a child whose own plane escaped the safe filter', () => {
    // The tool filter restricts the inherited plane only, so a per-agent
    // registration like the standard preset's `subagent` survives it. The
    // installed surface is a request; this read is the effect.
    const deps = ports({ surface: surface({ visibleTools: vi.fn(() => [...SAFE_SURFACE, 'subagent']) }) })

    try {
      composeLocusChild(agent(), deps)
      expect.unreachable('a leaked tool surface must never be published')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('surface-not-attested')
      expect((error as LocusCompositionError).message).toContain('subagent')
    }
  })

  it('refuses to publish a child whose surface cannot be read', () => {
    const deps = ports({ surface: surface({ visibleTools: undefined }) })

    try {
      composeLocusChild(agent(), deps)
      expect.unreachable('an unread surface must never be published')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('surface-not-attested')
    }
  })

  it('refuses to publish when reading the surface throws', () => {
    const deps = ports({
      surface: surface({ visibleTools: vi.fn(() => { throw new Error('tools service gone') }) }),
    })

    try {
      composeLocusChild(agent(), deps)
      expect.unreachable('a failed read must never be published')
    } catch (error) {
      expect((error as LocusCompositionError).reason).toBe('surface-not-attested')
    }
  })

  it('lists the child-scope tools of the three-tier model and none of the retired ones', () => {
    expect(LOCUS_CALLER_BOUND_TOOLS).toEqual(expect.arrayContaining(['locus_context', 'locus_ask_parent']))
    for (const retired of [
      'pet_collaboration_context',
      'pet_collaboration_context_update',
      'pet_collaborators',
      'pet_inquire',
      'pet_inquiry_answer',
      'pet_locus_parent_lookup',
      'pet_locus_request_execution',
    ]) expect(LOCUS_CALLER_BOUND_TOOLS).not.toContain(retired)
    // A child has no collaboration tools at all.
    expect(LOCUS_CALLER_BOUND_TOOLS.filter(name => name.startsWith('collab_'))).toEqual([])
    expect(attestLocusComposition([...SAFE_SURFACE, 'collab_read']).leaks).toEqual(['collab_read'])
  })
})

/**
 * The caller-bound entrance read must be explained by the reviewed allowlist,
 * in BOTH tiers: attestation refuses a publication whose visible surface it
 * cannot account for, so a new own-plane tool is a publication gate, not a
 * detail.
 */
describe('the caller-bound entrance read joins the reviewed allowlist', () => {
  it('is listed in the caller-bound tools and attests in safe and shell tiers', () => {
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain('pet_locus_chat_history')

    expect(attestLocusComposition(SAFE_SURFACE, 'safe')).toMatchObject({ ok: true, leaks: [] })
    expect(attestLocusComposition(
      [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_SHELL_TIER_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS],
      'shell',
    )).toMatchObject({ ok: true, leaks: [] })
  })
})

describe('spec Scenario "文档子会话的工具面"', () => {
  it('the doc read is reviewed in both tiers, and the per-kind choice is exclusive in the Host wiring', async () => {
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain('pet_locus_doc_context')
    const docSurface = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS.filter(name => name !== 'pet_locus_chat_history')]
    expect(attestLocusComposition(docSurface, 'safe')).toMatchObject({ ok: true, leaks: [] })
    expect(attestLocusComposition([...docSurface, ...LOCUS_SHELL_TIER_TOOL_NAMES], 'shell')).toMatchObject({ ok: true, leaks: [] })

    // The Host publishes exactly one read tool per child by entry kind.
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const index = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const branch = index.slice(index.indexOf('One read tool per child, by entry kind'), index.indexOf('One read tool per child, by entry kind') + 1600)
    expect(branch).toMatch(/isDocEndpoint\([\s\S]*locusDocContext:[\s\S]*: \(larkClient\.readEntranceHistory === undefined[\s\S]*locusHistory:/)
  })
})

