import { describe, expect, it, vi } from 'vitest'
import {
  attestLocusComposition,
  classifyLocusCompositionFailure,
  composeLocusChild,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_DELEGATION_DENYLIST,
  LOCUS_FULL_ACCESS_TOOL_NAMES,
  LOCUS_SAFE_TOOL_NAMES,
  LocusCompositionError,
  type LocusChildComposition,
  type LocusCompositionPorts,
} from '../src/host/locus/composition.js'
import type { LocusAccessModeV20 } from '../src/host/locus/contract-v20.js'
import { LOCUS_WRITE_DISABLED_DIAGNOSTIC } from '../src/host/locus/policy-verification.js'
import { LOCUS_BASE_PRESET, LOCUS_CHILD_PRESET } from '../src/host/locus/preset.js'

const CHILD = 'session-1'

/** The reviewed surface a composed read-only child is expected to expose. */
const SAFE_SURFACE: readonly string[] = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS]
const FULL_SURFACE: readonly string[] = [...SAFE_SURFACE, ...LOCUS_FULL_ACCESS_TOOL_NAMES]

function composition(overrides: Partial<LocusChildComposition> = {}): LocusChildComposition {
  return {
    locusMainSessionId: 'main-1',
    sessionId: CHILD,
    locusId: 'locus-1',
    revision: 2,
    accessMode: 'read-only',
    endpoint: { chatId: 'oc-1' },
    ...overrides,
  }
}

/**
 * A complete surface seam whose restriction layer really narrows what
 * `visibleTools` reports, like the Host's `tools.restrict`.
 */
function surface(overrides: Partial<NonNullable<LocusCompositionPorts['surface']>> = {}) {
  let visible: readonly string[] = FULL_SURFACE
  return {
    install: vi.fn(),
    applyAccessMode: vi.fn((_agent: unknown, mode: LocusAccessModeV20) => {
      visible = mode === 'read-only' ? SAFE_SURFACE : FULL_SURFACE
    }),
    installOutboundGuard: vi.fn(),
    visibleTools: vi.fn(() => visible),
    ...overrides,
  }
}

function agent(id = CHILD) {
  return { id, scope: { get: vi.fn(() => ({})) } }
}

function ports(overrides: Partial<LocusCompositionPorts> = {}): LocusCompositionPorts {
  const applied = new Map<string, LocusAccessModeV20>()
  return {
    lookup: { find: vi.fn(() => composition()) },
    parentPreset: vi.fn(() => LOCUS_BASE_PRESET),
    childPreset: vi.fn(() => LOCUS_CHILD_PRESET),
    writeEnabled: true,
    surface: surface(),
    policy: {
      apply: vi.fn((sessionId: string, mode: LocusAccessModeV20) => { applied.set(sessionId, mode) }),
      resolve: vi.fn((sessionId: string) => applied.get(sessionId)),
    },
    ...overrides,
  }
}

function refusal(deps: LocusCompositionPorts): LocusCompositionError {
  try {
    composeLocusChild(agent(), deps)
  } catch (error) {
    expect(error).toBeInstanceOf(LocusCompositionError)
    return error as LocusCompositionError
  }
  throw new Error('composition must refuse')
}

describe('unified locus child composition', () => {
  it('installs the caller-bound surface on the child scope and verifies the read-only sandbox', () => {
    const deps = ports()
    const candidate = agent()

    expect(composeLocusChild(candidate, deps)).toEqual({
      composed: true,
      composition: composition(),
      accessMode: 'read-only',
    })
    // Registered against the child's OWN scope object.
    expect(deps.surface?.install).toHaveBeenCalledWith(candidate, composition())
    expect(deps.policy?.apply).toHaveBeenCalledWith(CHILD, 'read-only')
  })

  it('leaves an ordinary session untouched', () => {
    const deps = ports({ lookup: { find: vi.fn(() => undefined) } })

    expect(composeLocusChild(agent('ordinary'), deps)).toEqual({ composed: false })
    expect(deps.surface?.install).not.toHaveBeenCalled()
    expect(deps.policy?.apply).not.toHaveBeenCalled()
  })

  it('refuses to publish a locus child when the Host has no surface or policy seam', () => {
    expect(refusal(ports({ surface: undefined })).reason).toBe('surface-unavailable')
    expect(refusal(ports({ policy: undefined })).reason).toBe('policy-unavailable')
  })

  it('refuses when the resolved sandbox does not match the row, in both directions, without trying another mode', () => {
    for (const [row, resolved] of [['read-only', 'danger-full-access'], ['danger-full-access', 'read-only']] as const) {
      const apply = vi.fn()
      const deps = ports({
        lookup: { find: vi.fn(() => composition({ accessMode: row })) },
        policy: { apply, resolve: vi.fn(() => resolved) },
      })
      expect(refusal(deps).reason).toBe('policy-not-verified')
      // No fallback: exactly the row's value was applied, once.
      expect(apply.mock.calls).toEqual([[CHILD, row]])
    }
  })

  it('refuses when the Host resolves no sandbox at all', () => {
    const error = refusal(ports({ policy: { apply: vi.fn(), resolve: vi.fn(() => undefined) } }))
    expect(error.reason).toBe('policy-not-verified')
    expect(error.message).toContain('无策略')
  })

  it('applies the sandbox before installing the surface', () => {
    const order: string[] = []
    const deps = ports({
      surface: surface({ install: vi.fn(() => { order.push('surface') }) }),
      policy: { apply: vi.fn(() => { order.push('policy') }), resolve: vi.fn(() => 'read-only' as const) },
    })
    composeLocusChild(agent(), deps)
    expect(order).toEqual(['policy', 'surface'])
  })

  it('reports a failing surface or policy application without publishing', () => {
    const surfaceFailure = refusal(ports({
      surface: surface({ install: vi.fn(() => { throw new Error('tools unavailable') }) }),
    }))
    expect(surfaceFailure.reason).toBe('surface-failed')
    expect(surfaceFailure.cause).toBeInstanceOf(Error)

    expect(refusal(ports({
      policy: { apply: vi.fn(() => { throw new Error('sandbox rejected') }), resolve: vi.fn(() => 'read-only' as const) },
    })).reason).toBe('policy-failed')
  })

  it('refuses an unusable lookup (class B) and a mismatched child identity (class A)', () => {
    const broken = refusal(ports({ lookup: { find: vi.fn(() => { throw new Error('store unavailable') }) } }))
    expect(broken.reason).toBe('lookup-failed')
    expect(classifyLocusCompositionFailure(broken)).toBe('B')

    const mismatched = refusal(ports({ lookup: { find: vi.fn(() => composition({ sessionId: 'session-other' })) } }))
    expect(mismatched.reason).toBe('identity-unproven')
    expect(classifyLocusCompositionFailure(mismatched)).toBe('A')
  })

  it('composes a verified danger-full-access child', () => {
    const deps = ports({ lookup: { find: vi.fn(() => composition({ accessMode: 'danger-full-access' })) } })
    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true, accessMode: 'danger-full-access' })
    expect(deps.surface?.applyAccessMode).toHaveBeenCalledWith(expect.anything(), 'danger-full-access')
  })
})

describe('locus composition attestation', () => {
  it('accepts the read-only surface and the explicit full-access surface', () => {
    expect(attestLocusComposition(SAFE_SURFACE)).toEqual({ ok: true, leaks: [] })
    expect(attestLocusComposition(FULL_SURFACE, 'danger-full-access')).toEqual({ ok: true, leaks: [] })
    expect(attestLocusComposition([...SAFE_SURFACE].reverse().concat('read')).ok).toBe(true)
  })

  it('names tools outside the selected access mode and every delegation route', () => {
    expect(attestLocusComposition([...SAFE_SURFACE, 'subagent'])).toEqual({ ok: false, reason: 'leaked', leaks: ['subagent'] })
    expect(attestLocusComposition([...SAFE_SURFACE, 'bash'])).toMatchObject({ ok: false, leaks: ['bash'] })
    expect(attestLocusComposition(['bash', 'subagent', 'bash'], 'danger-full-access')).toMatchObject({ ok: false, leaks: ['subagent'] })
    expect(attestLocusComposition([...SAFE_SURFACE, 'workflow'])).toMatchObject({ ok: false, leaks: ['workflow'] })
    expect(LOCUS_DELEGATION_DENYLIST).toContain('subagent')
    expect(LOCUS_DELEGATION_DENYLIST).toContain('send_message')
  })

  it('requires bash to be visible in danger-full-access', () => {
    expect(attestLocusComposition(SAFE_SURFACE, 'danger-full-access')).toMatchObject({
      ok: false,
      leaks: ['bash (required for danger-full-access)'],
    })
  })

  it('refuses a surface it cannot read instead of treating silence as a pass', () => {
    expect(attestLocusComposition(undefined)).toEqual({ ok: false, reason: 'unreadable', leaks: [] })
  })
})

describe('unified locus child publication', () => {
  it('spec Scenario "子委派不能洗白权限"', () => {
    for (const mode of ['read-only', 'danger-full-access'] as const) {
      for (const route of ['subagent', 'workflow', 'ralph', 'send_message']) {
        const error = refusal(ports({
          lookup: { find: vi.fn(() => composition({ accessMode: mode })) },
          surface: surface({ visibleTools: vi.fn(() => [...(mode === 'read-only' ? SAFE_SURFACE : FULL_SURFACE), route]) }),
        }))
        expect(error.reason).toBe('surface-not-attested')
        expect(error.message).toContain(route)
        expect(classifyLocusCompositionFailure(error)).toBe('B')
      }
    }
  })

  it('spec Scenario "收紧层未安装时不发布"', () => {
    for (const broken of [
      surface({ applyAccessMode: undefined }),
      surface({ applyAccessMode: vi.fn(() => { throw new Error('tools.restrict is unavailable') }) }),
      // "installed" but the readback still shows the wide base
      surface({ applyAccessMode: vi.fn(), visibleTools: vi.fn(() => FULL_SURFACE) }),
    ]) {
      const error = refusal(ports({ surface: broken }))
      expect(error.reason).toBe('surface-not-attested')
      expect(classifyLocusCompositionFailure(error)).toBe('B')
    }
  })

  it('requires the outbound guard before any child may publish', () => {
    expect(refusal(ports({ surface: surface({ installOutboundGuard: undefined }) })).reason).toBe('surface-not-attested')
  })

  it('applies the read-only restriction before reading the fresh staging surface', () => {
    const deps = ports()
    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true })
    expect(deps.surface?.applyAccessMode).toHaveBeenCalledOnce()
    expect(deps.surface?.applyAccessMode).toHaveBeenCalledWith(expect.anything(), 'read-only')
  })

  it('spec Scenario "隔离能力无法证明时不发布"', () => {
    // runtime without tools.restrict: the Host's applyAccessMode throws (class B).
    const noRestrict = refusal(ports({
      surface: surface({ applyAccessMode: vi.fn(() => { throw new Error('Agent-scoped tools.restrict is unavailable') }) }),
    }))
    expect(noRestrict.reason).toBe('surface-not-attested')
    expect(classifyLocusCompositionFailure(noRestrict)).toBe('B')

    // A locus main preset that cannot be proven is NOT this scenario: it is M unavailable.
    for (const deps of [
      { ...ports(), parentPreset: undefined },
      ports({ parentPreset: vi.fn(() => { throw new Error('session gone') }) }),
      ports({ parentPreset: vi.fn(() => undefined) }),
    ]) {
      const error = refusal(deps)
      expect(error.reason).toBe('main-unavailable')
      expect(classifyLocusCompositionFailure(error)).toBe('main-unavailable')
      expect(deps.surface?.install).not.toHaveBeenCalled()
      expect(deps.policy?.apply).not.toHaveBeenCalled()
    }
  })

  it('子会话自身 preset 无法证明或偏离 locus-child 时不发布（工具上限即该 preset）', () => {
    for (const deps of [
      { ...ports(), childPreset: undefined },
      ports({ childPreset: vi.fn(() => { throw new Error('session gone') }) }),
      ports({ childPreset: vi.fn(() => undefined) }),
    ]) {
      expect(refusal(deps).reason).toBe('preset-unverified')
      expect(deps.surface?.install).not.toHaveBeenCalled()
      expect(deps.policy?.apply).not.toHaveBeenCalled()
    }
    for (const preset of [LOCUS_BASE_PRESET, 'standard', 'dsh-pet-executor']) {
      const deps = ports({ childPreset: vi.fn(() => preset) })
      const error = refusal(deps)
      expect(error.reason).toBe('preset-mismatch')
      expect(classifyLocusCompositionFailure(error)).toBe('B')
      expect(deps.surface?.install).not.toHaveBeenCalled()
    }
    const deps = ports()
    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true })
    expect(deps.childPreset).toHaveBeenCalledWith(CHILD)
  })

  it('spec Scenario "主会话 preset 不影响子会话工具面"', () => {
    // The work main runs `standard`; it is not the child's parent, so only the
    // locus main's preset and the child's own readback decide the surface.
    const presets = new Map([['main-locus', LOCUS_BASE_PRESET], ['main-work', 'standard']])
    const deps = ports({
      lookup: { find: vi.fn(() => composition({ locusMainSessionId: 'main-locus' })) },
      parentPreset: vi.fn((id: string) => presets.get(id)),
    })
    expect(composeLocusChild(agent(), deps)).toMatchObject({ composed: true })
    expect(deps.parentPreset).toHaveBeenCalledWith('main-locus')
    expect(deps.parentPreset).not.toHaveBeenCalledWith('main-work')
  })

  it('spec Scenario "冷恢复不回落到父组合"', () => {
    const persisted = composition({ accessMode: 'danger-full-access' })
    const resumed = ports({ lookup: { find: vi.fn(() => persisted) } })
    expect(composeLocusChild(agent(), resumed)).toMatchObject({ composed: true, accessMode: 'danger-full-access' })
    expect(resumed.surface?.applyAccessMode).toHaveBeenCalledWith(expect.anything(), 'danger-full-access')

    // A locus main that left `locus-base` is M unavailable (whole-W migration), not a composition failure.
    const drifted = ports({ lookup: { find: vi.fn(() => persisted) }, parentPreset: vi.fn(() => 'standard') })
    const mainError = refusal(drifted)
    expect(classifyLocusCompositionFailure(mainError)).toBe('main-unavailable')
    expect(drifted.surface?.install).not.toHaveBeenCalled()

    // A child whose own preset fell back to the parent's composition: class B.
    const fellBack = ports({ lookup: { find: vi.fn(() => persisted) }, childPreset: vi.fn(() => LOCUS_BASE_PRESET) })
    const childError = refusal(fellBack)
    expect(childError.reason).toBe('preset-mismatch')
    expect(classifyLocusCompositionFailure(childError)).toBe('B')
    expect(fellBack.surface?.install).not.toHaveBeenCalled()
  })

  it('spec Scenario "升级前的 legacy child 不可恢复服务"', () => {
    // There is no persisted marker any more: a legacy child is one whose
    // composition does not verify against its row's accessMode on cold resume.
    for (const deps of [
      ports({ childPreset: vi.fn(() => 'dsh-pet-executor') }),
      ports({ surface: surface({ visibleTools: vi.fn(() => [...FULL_SURFACE, 'subagent']) }) }),
      ports({ policy: { apply: vi.fn(), resolve: vi.fn(() => 'danger-full-access' as const) } }),
    ]) {
      const error = refusal(deps)
      expect(classifyLocusCompositionFailure(error)).toBe('B')
    }
  })

  it('spec Scenario "组合失败的分类处理" (composition seam: A / B / M classification)', () => {
    // 子会话身份无法证明 → A
    expect(classifyLocusCompositionFailure(
      refusal(ports({ lookup: { find: vi.fn(() => composition({ sessionId: 'other' })) } })),
    )).toBe('A')
    // 回读与 accessMode 不符 → B
    expect(classifyLocusCompositionFailure(
      refusal(ports({ policy: { apply: vi.fn(), resolve: vi.fn(() => 'danger-full-access' as const) } })),
    )).toBe('B')
    // 写开关关闭且 accessMode = danger-full-access → B, with the global diagnostic
    const writeOff = refusal(ports({
      writeEnabled: false,
      lookup: { find: vi.fn(() => composition({ accessMode: 'danger-full-access' })) },
    }))
    expect(writeOff.reason).toBe('write-disabled')
    expect(writeOff.message).toBe(LOCUS_WRITE_DISABLED_DIAGNOSTIC)
    expect(classifyLocusCompositionFailure(writeOff)).toBe('B')
    // composeLocusChild 证明失败 → B
    expect(classifyLocusCompositionFailure(
      refusal(ports({ surface: surface({ visibleTools: vi.fn(() => undefined) }) })),
    )).toBe('B')
    // runtime 缺少 tools.restrict → B
    expect(classifyLocusCompositionFailure(
      refusal(ports({ surface: surface({ applyAccessMode: undefined }) })),
    )).toBe('B')
    // Anything that is not a composition error is B too.
    expect(classifyLocusCompositionFailure(new Error('runtime'))).toBe('B')
  })

  it('refuses to publish a child whose own plane escaped the read-only filter', () => {
    const error = refusal(ports({ surface: surface({ visibleTools: vi.fn(() => [...SAFE_SURFACE, 'subagent']) }) }))
    expect(error.reason).toBe('surface-not-attested')
    expect(error.message).toContain('subagent')
  })

  it('refuses to publish a child whose surface cannot be read, or whose read throws', () => {
    expect(refusal(ports({ surface: surface({ visibleTools: undefined }) })).reason).toBe('surface-not-attested')
    expect(refusal(ports({
      surface: surface({ visibleTools: vi.fn(() => { throw new Error('tools service gone') }) }),
    })).reason).toBe('surface-not-attested')
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
    expect(LOCUS_CALLER_BOUND_TOOLS.filter(name => name.startsWith('collab_'))).toEqual([])
    expect(attestLocusComposition([...SAFE_SURFACE, 'collab_read']).leaks).toEqual(['collab_read'])
  })
})

describe('the caller-bound entrance read joins the reviewed allowlist', () => {
  it('is listed in the caller-bound tools and attests in both access modes', () => {
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain('pet_locus_chat_history')
    expect(attestLocusComposition(SAFE_SURFACE, 'read-only')).toMatchObject({ ok: true, leaks: [] })
    expect(attestLocusComposition(FULL_SURFACE, 'danger-full-access')).toMatchObject({ ok: true, leaks: [] })
  })
})

describe('spec Scenario "文档子会话的工具面"', () => {
  it('the doc read is reviewed in both access modes, and the per-kind choice is exclusive in the Host wiring', async () => {
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain('pet_locus_doc_context')
    const docSurface = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS.filter(name => name !== 'pet_locus_chat_history')]
    expect(attestLocusComposition(docSurface, 'read-only')).toMatchObject({ ok: true, leaks: [] })
    expect(attestLocusComposition([...docSurface, ...LOCUS_FULL_ACCESS_TOOL_NAMES], 'danger-full-access')).toMatchObject({ ok: true, leaks: [] })

    // The Host publishes exactly one read tool per child by entry kind.
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const index = await readFile(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8')
    const branch = index.slice(index.indexOf('One read tool per child, by entry kind'), index.indexOf('One read tool per child, by entry kind') + 1600)
    expect(branch).toMatch(/isDocEndpoint\([\s\S]*locusDocContext:[\s\S]*: \(larkClient\.readEntranceHistory === undefined[\s\S]*locusHistory:/)
  })
})
