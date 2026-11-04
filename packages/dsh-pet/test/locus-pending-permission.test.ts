import { describe, expect, it, vi } from 'vitest'
import { LOCUS_SAFE_CHILD_COMPOSITION } from '../src/host/locus/aggregate.js'
import {
  composeLocusChild,
  LocusCompositionError,
  LOCUS_CALLER_BOUND_TOOLS,
  LOCUS_SAFE_TOOL_NAMES,
  LOCUS_SHELL_TIER_TOOL_NAMES,
  type LocusChildComposition,
  type LocusChildPermission,
} from '../src/host/locus/composition.js'
import {
  LocusPendingApplicationError,
  resolveLocusPendingApplication,
} from '../src/host/locus/pending-application.js'
import { LocusRepository } from '../src/host/locus/repository.js'
import { createLocusPermissionMutation, LocusPermissionMutationError } from '../src/host/locus/permission-mutation.js'
import { createLocusToolTierMutation, type ToolTierMutationLocus } from '../src/host/locus/tool-tier-mutation.js'
import { LOCUS_BASE_PRESET } from '../src/host/locus/preset.js'

const SAFE_TOOLS = [...LOCUS_SAFE_TOOL_NAMES, ...LOCUS_CALLER_BOUND_TOOLS]
const SHELL_TOOLS = [...SAFE_TOOLS, ...LOCUS_SHELL_TIER_TOOL_NAMES]

interface Row extends ToolTierMutationLocus {
  permission: { desired: LocusChildPermission; effective: LocusChildPermission; verifiedAt: number; grantedBy?: string }
  toolTier: { desired: 'safe' | 'shell'; effective: 'safe' | 'shell'; verifiedAt?: number; grantedBy?: string }
}

/**
 * One locus row in memory behind the REAL tier mutation, the REAL composer and
 * the REAL pending resolver. Only the Host seams (live registry, tool readback,
 * sandbox policy, Lark notification) are stand-ins.
 */
function world(options: { tier?: 'safe' | 'shell'; resident?: boolean; idle?: boolean } = {}) {
  let row: Row = {
    id: 'locus-1',
    generation: 3,
    revision: 7,
    updatedAt: 100,
    endpoint: { chatId: 'oc_group' },
    childSessionId: 'child-1',
    childComposition: LOCUS_SAFE_CHILD_COMPOSITION,
    state: 'active',
    busy: false,
    permission: { desired: 'read', effective: 'read', verifiedAt: 50 },
    toolTier: { desired: options.tier ?? 'safe', effective: options.tier ?? 'safe', verifiedAt: 50, grantedBy: 'ou_owner' },
  }
  const resident = { value: options.resident ?? false }
  let clock = 200
  const now = () => clock++
  const repository = {
    findLocus: vi.fn((id: string) => id === row.id ? row : undefined),
    findCurrentLocus: vi.fn(() => row),
    getLocusByChild: vi.fn(() => row),
    hasPendingDeliveries: vi.fn(() => false),
    beginToolTierMutation: vi.fn(async () => {
      row = { ...row, state: 'switching', revision: row.revision! + 1 }
      return row
    }),
    commitToolTierMutation: vi.fn(async (_id: string, tier: Row['toolTier']) => {
      row = { ...row, state: 'active', toolTier: tier, revision: row.revision! + 1 }
      return row
    }),
    abortToolTierMutation: vi.fn(async () => {
      row = { ...row, state: 'active', revision: row.revision! + 1 }
      return row
    }),
    invalidateToolTierMutation: vi.fn(async () => row),
    resolvePendingApplication: vi.fn(async (input: {
      permission?: Row['permission']
      toolTier?: Row['toolTier']
    }) => {
      row = {
        ...row,
        ...(input.permission === undefined ? {} : { permission: input.permission }),
        ...(input.toolTier === undefined ? {} : { toolTier: input.toolTier }),
        revision: row.revision! + 1,
      }
      return row
    }),
    getLocus: (id: string) => id === row.id ? row : undefined,
  }

  // The live agent, when resident: a tool surface that follows setToolTier.
  const live = { visible: row.toolTier.effective === 'shell' ? SHELL_TOOLS : SAFE_TOOLS }
  const liveSurface = {
    isIdle: () => options.idle ?? true,
    setToolTier: vi.fn((tier: 'safe' | 'shell') => { live.visible = tier === 'shell' ? SHELL_TOOLS : SAFE_TOOLS }),
    visibleTools: () => live.visible,
  }
  const mutation = createLocusToolTierMutation({
    repository,
    live: { find: () => resident.value ? liveSurface : undefined },
    attest: (visible, tier) => tier === 'shell'
      ? SHELL_TOOLS.every(name => visible?.includes(name)) === true
      : LOCUS_SHELL_TIER_TOOL_NAMES.every(name => visible?.includes(name) === false),
    now,
  })

  // Wake-up: the runtime publishes the child again and `agent/created` runs.
  const notices: string[] = []
  const wake = async (behaviour: {
    /** Tools the child exposes after `setToolTier(tier)`, per tier; default is faithful. */
    surfaceFor?: (tier: 'safe' | 'shell') => readonly string[]
    policyResolve?: (mode: string) => LocusChildPermission
  } = {}) => {
    const surfaceFor = behaviour.surfaceFor ?? ((tier: 'safe' | 'shell') => tier === 'shell' ? SHELL_TOOLS : SAFE_TOOLS)
    let visible: readonly string[] = SAFE_TOOLS
    const setToolTier = vi.fn((_agent: unknown, tier: 'safe' | 'shell') => { visible = surfaceFor(tier) })
    const applied: LocusChildPermission[] = []
    const composition: LocusChildComposition = {
      revision: row.revision!,
      parentSessionId: 'main-locus',
      childSessionId: row.childSessionId!,
      locusId: row.id,
      generation: row.generation,
      permission: row.permission.effective,
      ...(row.permission.desired === row.permission.effective ? {} : { pendingPermission: row.permission.desired }),
      childComposition: 'tier3',
      toolTier: { desired: row.toolTier.desired, effective: row.toolTier.effective },
      endpoint: row.endpoint,
    }
    const result = composeLocusChild({ id: row.childSessionId!, scope: { get: () => ({}) } }, {
      lookup: { find: () => composition },
      parentPreset: () => LOCUS_BASE_PRESET,
      writeEnabled: true,
      surface: {
        install: vi.fn(),
        setToolTier,
        installOutboundGuard: vi.fn(),
        visibleTools: () => visible,
      },
      policy: {
        apply: (_id, mode) => { applied.push(mode) },
        resolve: () => behaviour.policyResolve?.(applied.at(-1)!) ?? applied.at(-1),
      },
    })
    if (result.composed && result.pending !== undefined) {
      await resolveLocusPendingApplication({
        repository,
        notify: ({ text }) => { notices.push(text) },
        now,
      }, result.composition, result.pending)
    }
    return { result, setToolTier, served: visible }
  }
  return { mutation, repository, row: () => row, resident, wake, notices, liveSurface }
}

const set = (w: ReturnType<typeof world>, tier: 'safe' | 'shell') =>
  w.mutation.set({ locusId: 'locus-1', endpoint: { chatId: 'oc_group' }, tier, actor: 'ou_owner' })

describe('非驻留时授予 shell 并在唤醒时生效', () => {
  it('非驻留时授予 shell 并在唤醒时生效', async () => {
    const w = world({ tier: 'safe', resident: false })

    const first = await set(w, 'shell')

    // The request is only recorded; the child keeps serving under `safe`.
    expect(first).toMatchObject({ ok: true, effective: 'safe', pending: true })
    expect(w.row().toolTier).toMatchObject({ desired: 'shell', effective: 'safe' })
    expect(w.liveSurface.setToolTier).not.toHaveBeenCalled()
    expect(w.notices).toEqual([])

    // The wake-up Delivery makes the child current and publishes it again.
    const woke = await w.wake()

    expect(woke.setToolTier).toHaveBeenCalledWith(expect.anything(), 'shell')
    expect(woke.served).toEqual(SHELL_TOOLS)
    expect(w.row().toolTier).toMatchObject({ desired: 'shell', effective: 'shell' })
    expect(w.row()).toMatchObject({ childSessionId: 'child-1', generation: 3 })
    expect(w.notices).toHaveLength(1)
    expect(w.notices[0]).toContain('shell')
    expect(w.notices[0]).toContain('已')
  })
})

describe('唤醒时核验失败不留授权', () => {
  it('唤醒时核验失败不留授权', async () => {
    const w = world({ tier: 'safe', resident: false })
    await set(w, 'shell')

    // The shell readback does not match (bash never appears).
    const woke = await w.wake({ surfaceFor: () => SAFE_TOOLS })

    expect(woke.served).toEqual(SAFE_TOOLS)
    expect(w.row().toolTier).toMatchObject({ desired: 'safe', effective: 'safe' })
    expect(w.notices).toHaveLength(1)
    expect(w.notices[0]).toContain('未能核验')
    expect(w.notices[0]).toContain('safe')

    // Nothing is left to re-apply: the next wake serves `safe` and says nothing.
    const again = await w.wake()
    expect(again.setToolTier.mock.calls.map(call => call[1])).toEqual(['safe'])
    expect(w.notices).toHaveLength(1)
  })
})

describe('非驻留撤回 shell 核验失败恢复原值', () => {
  it('非驻留撤回 shell 核验失败恢复原值', async () => {
    const w = world({ tier: 'shell', resident: false })
    const before = { generation: w.row().generation, child: w.row().childSessionId }

    await set(w, 'safe')
    expect(w.row().toolTier).toMatchObject({ desired: 'safe', effective: 'shell' })

    // Waking: the safe readback still shows bash; the original shell readback is fine.
    const woke = await w.wake({
      surfaceFor: tier => tier === 'safe' ? [...SAFE_TOOLS, 'bash'] : SHELL_TOOLS,
    })

    expect(woke.setToolTier.mock.calls.map(call => call[1])).toEqual(['safe', 'shell'])
    expect(woke.served).toEqual(SHELL_TOOLS)
    expect(w.row().toolTier).toMatchObject({ desired: 'shell', effective: 'shell' })
    expect({ generation: w.row().generation, child: w.row().childSessionId }).toEqual(before)
    expect(w.notices[0]).toContain('未能核验')
  })
})

describe('原值也无法核验时不发布', () => {
  it('原值也无法核验时不发布', async () => {
    const w = world({ tier: 'shell', resident: false })
    await set(w, 'safe')

    // Neither tier verifies.
    await expect(w.wake({ surfaceFor: () => ['read', 'subagent'] })).rejects.toBeInstanceOf(LocusCompositionError)

    // Nothing was recorded as resolved: the row still shows the pending change,
    // so no Delivery is handed to an unverified composition.
    expect(w.repository.resolvePendingApplication).not.toHaveBeenCalled()
    expect(w.row().toolTier).toMatchObject({ desired: 'safe', effective: 'shell' })
    expect(w.notices).toEqual([])
  })

  it('does not publish when the outcome cannot be recorded', async () => {
    const w = world({ tier: 'safe', resident: false })
    await set(w, 'shell')
    w.repository.resolvePendingApplication.mockRejectedValueOnce(new Error('store down'))

    await expect(w.wake()).rejects.toBeInstanceOf(LocusPendingApplicationError)
  })
})

describe('常驻空闲时当场生效', () => {
  it('常驻空闲时当场生效', async () => {
    const w = world({ tier: 'safe', resident: true, idle: true })

    const result = await set(w, 'shell')

    expect(result).toMatchObject({ ok: true, effective: 'shell' })
    expect(result).not.toHaveProperty('pending')
    expect(w.liveSurface.setToolTier).toHaveBeenCalledWith('shell')
    // No pending record: desired and effective agree.
    expect(w.row().toolTier).toMatchObject({ desired: 'shell', effective: 'shell' })
    expect(w.repository.resolvePendingApplication).not.toHaveBeenCalled()
  })

  it('refuses a resident child that is running instead of recording a pending change', async () => {
    const w = world({ tier: 'safe', resident: true, idle: false })

    expect(await set(w, 'shell')).toEqual({ ok: false, reason: 'busy' })
    expect(w.row().toolTier).toMatchObject({ desired: 'safe', effective: 'safe' })
  })
})

describe('a later request overwrites an unapplied one', () => {
  it('a later request overwrites an unapplied one', async () => {
    const w = world({ tier: 'safe', resident: false })

    await set(w, 'shell')
    expect(w.row().toolTier).toMatchObject({ desired: 'shell', effective: 'safe' })
    const second = await set(w, 'safe')

    // Back to what is already in force: nothing pending any more.
    expect(second).toMatchObject({ ok: true, effective: 'safe' })
    expect(second).not.toHaveProperty('pending')
    expect(w.row().toolTier).toMatchObject({ desired: 'safe', effective: 'safe' })
  })
})

describe('a pending file permission change', () => {
  const pendingWrite = (): LocusChildComposition => ({
    parentSessionId: 'main-locus',
    childSessionId: 'child-1',
    locusId: 'locus-1',
    generation: 3,
    permission: 'read',
    pendingPermission: 'write',
    childComposition: 'tier3',
    toolTier: { desired: 'safe', effective: 'safe' },
  })
  const ports = (resolveAfter: (applied: LocusChildPermission[]) => LocusChildPermission | undefined) => {
    const applied: LocusChildPermission[] = []
    return {
      applied,
      ports: {
        lookup: { find: () => pendingWrite() },
        parentPreset: () => LOCUS_BASE_PRESET,
        writeEnabled: true,
        surface: {
          install: vi.fn(),
          setToolTier: vi.fn(),
          installOutboundGuard: vi.fn(),
          visibleTools: () => SAFE_TOOLS,
        },
        policy: {
          apply: (_id: string, mode: LocusChildPermission) => { applied.push(mode) },
          resolve: () => resolveAfter(applied),
        },
      },
    }
  }
  const agent = { id: 'child-1', scope: { get: () => ({}) } }

  it('applies the requested permission when it reads back', () => {
    const { ports: p, applied } = ports(a => a.at(-1))
    const result = composeLocusChild(agent, p)
    expect(applied).toEqual(['write'])
    expect(result).toMatchObject({
      composed: true,
      effectivePermission: 'write',
      pending: { permission: { requested: 'write', effective: 'write', applied: true } },
    })
  })

  it('serves the original permission, verified, when the request does not read back', () => {
    const { ports: p, applied } = ports(a => a.at(-1) === 'write' ? 'read' : a.at(-1))
    const result = composeLocusChild(agent, p)
    expect(applied).toEqual(['write', 'read'])
    expect(result).toMatchObject({
      composed: true,
      effectivePermission: 'read',
      pending: { permission: { requested: 'write', effective: 'read', applied: false } },
    })
  })

  it('declines a write request without trying it while write grants are switched off', () => {
    const { ports: p, applied } = ports(a => a.at(-1))
    const result = composeLocusChild(agent, { ...p, writeEnabled: false })
    expect(applied).toEqual(['read'])
    expect(result).toMatchObject({ pending: { permission: { applied: false, effective: 'read' } } })
  })

  it('refuses to publish when neither permission verifies', () => {
    // Whatever was applied, the Host reads back the other mode.
    const broken = ports(a => a.at(-1) === 'read' ? 'write' : 'read')
    expect(() => composeLocusChild(agent, broken.ports)).toThrow(LocusCompositionError)
  })
})


describe('recording a file permission change for a released child', () => {
  function permissionWorld(options: { resident?: boolean; idle?: boolean; writeEnabled?: boolean } = {}) {
    const repository = new LocusRepository()
    repository.ensureLocus({
      id: 'locus-current',
      endpoint: { chatId: 'oc_scope' },
      workspaceId: 'workspace-a',
      parentSessionId: 'session-parent',
      childSessionId: 'session-child',
      source: 'auto',
      permission: { desired: 'read', effective: 'read', verifiedAt: 1 },
      state: 'active',
      createdAt: 1,
    })
    const apply = vi.fn()
    const resolve = vi.fn(() => ({ mode: 'read-only', workspaceRoot: '/repo' }))
    const sessionsResolve = vi.fn(() => options.resident === true
      ? { id: 'session-child', isIdle: () => options.idle ?? true }
      : undefined)
    const mutation = createLocusPermissionMutation({
      writeEnabled: options.writeEnabled ?? true,
      repository: {
        getLocus: id => repository.getLocus(id),
        getCurrentLocus: endpoint => repository.getCurrent(endpoint),
        getLocusByChild: child => repository.getLocusByChild(child),
        hasPendingDeliveries: () => false,
        beginPermissionMutation: (id, now) => repository.beginPermissionMutation(id, now),
        abortPermissionMutation: (id, now) => repository.abortPermissionMutation(id, now),
        commitPermissionMutation: (id, permission, now) => repository.commitPermissionMutation(id, permission, now),
      },
      sessions: { resolve: sessionsResolve },
      policy: { apply, resolve },
      now: () => 10,
    })
    return { repository, mutation, apply, resolve, sessionsResolve }
  }

  it('records the request, touches no sandbox and keeps the permission in force', async () => {
    const w = permissionWorld({ resident: false })

    const next = await w.mutation.mutate({ locusId: 'locus-current', actorId: 'ou_owner', mode: 'write' })

    expect(w.apply).not.toHaveBeenCalled()
    expect(w.resolve).not.toHaveBeenCalled()
    expect(next.permission).toMatchObject({ desired: 'write', effective: 'read', grantedBy: 'ou_owner' })
    expect(next.state).toBe('active')
  })

  it('declines a write request up front while write grants are switched off, leaving nothing pending', async () => {
    const w = permissionWorld({ resident: false, writeEnabled: false })

    await expect(w.mutation.mutate({ locusId: 'locus-current', actorId: 'ou_owner', mode: 'write' }))
      .rejects.toMatchObject({ code: 'WRITE_UNSUPPORTED' })
    expect(w.repository.getLocus('locus-current')).toMatchObject({
      state: 'active',
      permission: { desired: 'read', effective: 'read' },
    })
  })

  it('refuses a resident child that is running rather than recording a change it cannot apply', async () => {
    const w = permissionWorld({ resident: true, idle: false })

    await expect(w.mutation.mutate({ locusId: 'locus-current', actorId: 'ou_owner', mode: 'write' }))
      .rejects.toBeInstanceOf(LocusPermissionMutationError)
    expect(w.apply).not.toHaveBeenCalled()
    expect(w.repository.getLocus('locus-current')?.state).toBe('active')
  })
})
