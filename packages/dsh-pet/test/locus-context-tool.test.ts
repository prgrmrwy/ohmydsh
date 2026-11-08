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
    locus: { locusId: 'locus-1', state: 'active', revision: 2 },
    main: { sessionId: 'main-1', title: '研发主会话' },
    child: { sessionId: 'child-1', title: '项目子会话' },
    workspace: { workspaceId: 'workspace-1', title: '项目工作区' },
    accessMode: 'read-only',
    ...overrides,
  }
}

function repository(match: LocusContextRecord | undefined): LocusContextRepository {
  return { findBySessionId: vi.fn(() => match) }
}

describe('caller-bound unified locus pet_context', () => {
  it('reverse-resolves an active child and returns locus facts without an Invocation', async () => {
    harness = await openPetHarness()
    const locusRepository = repository(
      locusRecord({
        currentDelivery: {
          deliveryId: 'delivery-1',
          messageId: 'om_message-1',
          endpoint,
          locusId: 'locus-1',
          sessionId: 'child-1',
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
    )
    const findTask = vi.spyOn(harness.repository, 'findTaskByExecutor')

    const result = executePetContext(
      harness.repository,
      { agent: { id: 'child-1' } },
      { locusRepository },
    )

    expect(result.scope).toBe('locus')
    const locus = result as PetLocusContextResult
    expect(locus.endpoint).toEqual(endpoint)
    expect(locus.locus).toEqual({ locusId: 'locus-1', state: 'active', revision: 2 })
    expect(locus.main).toEqual({ sessionId: 'main-1', title: '研发主会话' })
    expect(locus.child).toEqual({ sessionId: 'child-1', title: '项目子会话' })
    expect(locus.workspace).toEqual({ workspaceId: 'workspace-1', title: '项目工作区' })
    expect(locus.accessMode).toBe('read-only')
    expect(locus).not.toHaveProperty('permission')
    expect(locus).not.toHaveProperty('contextAnchor')
    expect(locus.currentDelivery?.deliveryId).toBe('delivery-1')
    expect(locus.currentDelivery?.replyTarget?.chatId).toBe(endpoint.chatId)
    expect(locus).not.toHaveProperty('taskId')
    expect(locus).not.toHaveProperty('invocationId')
    expect(findTask).not.toHaveBeenCalled()
  })

  it('rejects an unknown access mode rather than treating it as read-only', async () => {
    harness = await openPetHarness()
    expect(() => executePetContext(
      harness!.repository,
      { agent: { id: 'child-1' } },
      { locusRepository: repository(locusRecord({ accessMode: 'workspace-write' as never })) },
    )).toThrow(/unknown access mode/)
  })

  it('omits Delivery for a valid child on a local GUI turn', async () => {
    harness = await openPetHarness()
    const result = executePetContext(
      harness.repository,
      { agent: { id: 'child-1' } },
      { locusRepository: repository(locusRecord()) },
    )

    expect(result.scope).toBe('locus')
    expect(result).not.toHaveProperty('currentDelivery')
  })

  it('fails closed for invalid and stopped child associations (and not-created is not active)', async () => {
    harness = await openPetHarness()
    const unavailable = [
      { state: 'invalid', code: 'LOCUS_INVALID' },
      { state: 'stopped', code: 'LOCUS_STOPPED' },
      { state: 'not-created', code: 'LOCUS_INVALID' },
    ] as const
    for (const { state, code } of unavailable) {
      try {
        executePetContext(
          harness!.repository,
          { agent: { id: 'child-1' } },
          { locusRepository: repository(locusRecord({ locus: { locusId: 'locus-x', state, revision: 3 } })) },
        )
        throw new Error('expected context lookup to fail')
      } catch (error) {
        expect(error).toMatchObject({ code })
        expect(error).toHaveProperty('message', expect.stringContaining('refusing context lookup'))
      }
    }
  })

  it('fails closed when the repository cannot resolve the child (ambiguity is the repository\'s refusal)', async () => {
    harness = await openPetHarness()
    expect(() =>
      executePetContext(
        harness!.repository,
        { agent: { id: 'child-1' } },
        { locusRepository: { findBySessionId: () => { throw new Error('ambiguous sessionId') } } },
      ),
    ).toThrow(/Unable to resolve locus context/)
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
      { agent: { id: 'exec-1' } },
      { locusRepository: repository(undefined) },
    )

    expect(result.scope).toBe('invocation')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(result).toHaveProperty('invocationId', 'inv-1')
  })

  it('never accepts a model-provided target or selector', async () => {
    harness = await openPetHarness()
    const lookup = repository(locusRecord())
    const result = executePetContext(
      harness.repository,
      {
        agent: { id: 'child-1' },
        // Deliberately ignored extra fields model code cannot use to redirect lookup.
        target: 'child-other',
        locusId: 'locus-other',
      } as never,
      { locusRepository: lookup },
    )

    expect(result.scope).toBe('locus')
    expect(lookup.findBySessionId).toHaveBeenCalledWith('child-1')
  })
})
