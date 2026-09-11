import { afterEach, describe, expect, it, vi } from 'vitest'
import { executePetContext, type PetLocusContextResult } from '../src/host/context-tool.js'
import type {
  LocusContextRecord,
  LocusContextRepository,
} from '../src/host/locus/context-repository.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const endpoint = {
  chatId: 'oc_project00000000000000000000000',
  threadId: 'omt_topic000000000000000000000000',
  chatType: 'group' as const,
  chatName: '项目协作群',
}

function locusRecord(
  overrides: Partial<LocusContextRecord> = {},
): LocusContextRecord {
  return {
    endpoint,
    locus: { locusId: 'locus-1', generation: 2, state: 'active' },
    main: { sessionId: 'main-1', title: '研发主会话' },
    child: { sessionId: 'child-1', title: '项目子会话' },
    workspace: { workspaceId: 'workspace-1', title: '项目工作区' },
    permission: { effective: 'read', desired: 'read', verifiedAt: 100 },
    contextAnchor: {
      status: 'confirmed',
      executionRoot: '/repo/.worktrees/project',
      constraints: ['只在确认的执行根内工作'],
      provenance: 'main-confirmed',
      confirmedAt: 101,
    },
    ...overrides,
  }
}

function repository(
  matches: readonly LocusContextRecord[],
): LocusContextRepository {
  return {
    findByChildSessionId: vi.fn(() => matches),
  }
}

describe('caller-bound unified locus pet_context', () => {
  it('reverse-resolves an active child and returns locus facts without an Invocation', async () => {
    harness = await openPetHarness()
    const locusRepository = repository([
      locusRecord({
        currentDelivery: {
          deliveryId: 'delivery-1',
          messageId: 'om_message-1',
          endpoint,
          locusId: 'locus-1',
          generation: 2,
          childSessionId: 'child-1',
          status: 'running',
          senderOpenId: 'ou_sender',
          senderName: '张三',
          text: '请检查这个 topic 的风险。',
          replyTarget: {
            chatId: endpoint.chatId,
            threadId: endpoint.threadId,
            messageId: 'om_message-1',
            rootMessageId: 'om_root-1',
          },
        },
      }),
    ])
    const findTask = vi.spyOn(harness.repository, 'findTaskByExecutor')

    const result = executePetContext(
      harness.repository,
      { agent: { session: { id: 'child-1' } } },
      { locusRepository },
    )

    expect(result.scope).toBe('locus')
    const locus = result as PetLocusContextResult
    expect(locus.endpoint).toEqual(endpoint)
    expect(locus.locus).toEqual({ locusId: 'locus-1', generation: 2, state: 'active' })
    expect(locus.main).toEqual({ sessionId: 'main-1', title: '研发主会话' })
    expect(locus.child).toEqual({ sessionId: 'child-1', title: '项目子会话' })
    expect(locus.workspace).toEqual({ workspaceId: 'workspace-1', title: '项目工作区' })
    expect(locus.permission.effective).toBe('read')
    expect(locus.contextAnchor.executionRoot).toBe('/repo/.worktrees/project')
    expect(locus.contextAnchor).not.toHaveProperty('targetLocusId')
    expect(locus.currentDelivery?.deliveryId).toBe('delivery-1')
    expect(locus.currentDelivery?.replyTarget?.chatId).toBe(endpoint.chatId)
    expect(locus).not.toHaveProperty('taskId')
    expect(locus).not.toHaveProperty('invocationId')
    expect(findTask).not.toHaveBeenCalled()
  })

  it('reports missing anchors and negative authorization without inventing authority', async () => {
    harness = await openPetHarness()
    for (const contextAnchor of [
      { status: 'unknown' as const },
      { status: 'missing' as const },
      { status: 'confirmed' as const, executionRoot: '/repo', existence: 'exists' as const, authorization: 'unknown' as const },
      { status: 'confirmed' as const, executionRoot: '/repo', existence: 'exists' as const, authorization: 'unauthorized' as const },
    ]) {
      const result = executePetContext(
        harness!.repository,
        { agent: { session: { id: 'child-1' } } },
        { locusRepository: repository([locusRecord({ contextAnchor })]) },
      ) as PetLocusContextResult
      expect(result.scope).toBe('locus')
      expect(result.contextAnchor).toEqual(contextAnchor)
      expect(result.permission.effective).toBe('read')
      expect(result).not.toHaveProperty('currentDelivery')
    }
  })

  it('rejects malformed anchor facts rather than treating them as confirmation', async () => {
    harness = await openPetHarness()
    expect(() => executePetContext(
      harness!.repository,
      { agent: { session: { id: 'child-1' } } },
      { locusRepository: repository([locusRecord({
        contextAnchor: { status: 'trusted-by-model' } as never,
      })]) },
    )).toThrow(/Invalid execution anchor/)
  })

  it('omits Delivery for a valid child on a local GUI turn', async () => {
    harness = await openPetHarness()
    const result = executePetContext(
      harness.repository,
      { agent: { session: { id: 'child-1' } } },
      { locusRepository: repository([locusRecord()]) },
    )

    expect(result.scope).toBe('locus')
    expect(result).not.toHaveProperty('currentDelivery')
  })

  it('fails closed for invalid, stopped, retired, and legacy child associations', async () => {
    harness = await openPetHarness()
    const unavailable = [
      {
        record: locusRecord({ locus: { locusId: 'locus-invalid', generation: 2, state: 'invalid' } }),
        code: 'LOCUS_INVALID',
      },
      {
        record: locusRecord({ locus: { locusId: 'locus-stopped', generation: 2, state: 'stopped' } }),
        code: 'LOCUS_STOPPED',
      },
      {
        record: locusRecord({ locus: { locusId: 'locus-retired', generation: 2, state: 'retired' } }),
        code: 'LOCUS_INVALID',
      },
      { record: locusRecord({ legacy: true }), code: 'NOT_A_PET_SESSION' },
    ] as const
    for (const { record, code } of unavailable) {
      try {
        executePetContext(
          harness!.repository,
          { agent: { session: { id: 'child-1' } } },
          { locusRepository: repository([record]) },
        )
        throw new Error('expected context lookup to fail')
      } catch (error) {
        expect(error).toMatchObject({ code })
        expect(error).toHaveProperty('message', expect.stringContaining('refusing context lookup'))
      }
    }
  })

  it('fails closed for ambiguous reverse lookup instead of choosing an active row', async () => {
    harness = await openPetHarness()
    const first = locusRecord()
    const second = locusRecord({
      locus: { locusId: 'locus-2', generation: 3, state: 'active' },
    })

    expect(() =>
      executePetContext(
        harness!.repository,
        { agent: { session: { id: 'child-1' } } },
        { locusRepository: repository([first, second]) },
      ),
    ).toThrow(/ambiguous locus association/)
  })

  it('does not turn an ordinary Pet executor into a locus caller', async () => {
    harness = await openPetHarness()
    await harness.repository.createTask(testTask())
    await harness.repository.putSnapshot({
      id: 'snap-1',
      invocationId: 'inv-1',
      sourceKind: 'session',
      sourceSessionId: 'src-1',
      capturedAt: 1,
    })
    await harness.repository.appendInvocation(testInvocation())
    await harness.repository.setInvocationStatus('inv-1', 'running')

    const result = executePetContext(
      harness.repository,
      { agent: { session: { id: 'exec-1' } } },
      { locusRepository: repository([]) },
    )

    expect(result.scope).toBe('invocation')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(result).toHaveProperty('invocationId', 'inv-1')
  })

  it('never accepts a model-provided target or selector', async () => {
    harness = await openPetHarness()
    const lookup = repository([locusRecord()])
    const result = executePetContext(
      harness.repository,
      {
        agent: { session: { id: 'child-1' } },
        // Deliberately ignored extra fields model code cannot use to redirect lookup.
        target: 'child-other',
        locusId: 'locus-other',
      } as never,
      { locusRepository: lookup },
    )

    expect(result.scope).toBe('locus')
    expect(lookup.findByChildSessionId).toHaveBeenCalledWith('child-1')
  })
})
