/**
 * QA delivery: an admitted group message becomes one child turn.
 *
 * The invariants under test are the ones the spike warned about: acceptance
 * is not completion, the parent must be live before anything is queued, and a
 * settlement names only the child — so the delivery it belongs to is resolved
 * by FIFO order rather than by anything the runtime hands over.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QaDelivery } from '../src/host/qa/delivery.js'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import type { LiveAgentLike, SubagentSeam } from '../src/host/qa/subagents.js'
import type { PetChatBinding } from '../src/host/spec.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const QA_CHAT = 'oc_qagroup00000000000000000000000'
const CHILD = 'session-child'
const PARENT = 'session-source'
const ASKER = 'ou_asker00000000000000000000000'

/** The qa binding under test. */
function qaBinding(overrides: Partial<PetChatBinding> = {}): PetChatBinding {
  return {
    chatId: QA_CHAT,
    chatType: 'group',
    kind: 'qa',
    chatName: '答疑 · 登录问题',
    qaChildSessionId: CHILD,
    qaParentSessionId: PARENT,
    boundBy: 'user',
    boundAt: 1,
    ...overrides,
  }
}

/** One admitted group question. */
function event(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_q1',
    chat_id: QA_CHAT,
    chat_type: 'group',
    message_type: 'text',
    content: '@bot 这个报错怎么解',
    create_time: '2000',
    sender_id: ASKER,
    sender_type: 'user',
    ...overrides,
  } as LarkInboundEvent
}

interface Harnessed {
  readonly delivery: QaDelivery
  readonly queued: { childId: string; text: string; parentId: string }[]
  readonly reactions: { messageId: string; emoji: string }[]
  readonly removed: string[]
  readonly sent: { chatId: string; text: string }[]
  settle(childId: string, stopReason?: string): Promise<void>
}

/** Build a delivery over a harness, with the seam and Lark both faked. */
async function build(
  repositoryHarness: PetHarness,
  options: { resident?: boolean; resumeFails?: boolean; queueFails?: Error } = {},
): Promise<Harnessed> {
  const queued: { childId: string; text: string; parentId: string }[] = []
  const reactions: { messageId: string; emoji: string }[] = []
  const removed: string[] = []
  const sent: { chatId: string; text: string }[] = []
  let listener: ((info: { id: string; stopReason?: string }) => void) | undefined

  const seam: SubagentSeam = {
    agents: {
      get: (id: string) =>
        options.resident === false ? undefined : ({ session: { id } } as LiveAgentLike),
      resume: vi.fn(async ({ resumeSessionId }: { resumeSessionId: string }) => {
        if (options.resumeFails === true) throw new Error('cannot resume')
        return { agent: { session: { id: resumeSessionId } } as LiveAgentLike }
      }),
    },
    subagents: {
      startContinuable: vi.fn(async () => ({ childId: CHILD })),
      drainContinuableChildren: vi.fn(async () => undefined),
      listChildren: vi.fn(async () => []),
    },
    queuePrompt: vi.fn(async (parent: LiveAgentLike, childId: string, text: string) => {
      if (options.queueFails !== undefined) throw options.queueFails
      queued.push({ childId, text, parentId: parent.session.id })
      return 'message-1'
    }),
    onChildSettled: fn => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
  }

  const client: LarkClient = {
    addReaction: vi.fn(async (messageId: string, emoji: string) => {
      reactions.push({ messageId, emoji })
      return `reaction-${reactions.length}`
    }),
    removeReaction: vi.fn(async (_messageId: string, reactionId: string) => {
      removed.push(reactionId)
    }),
    listMessages: vi.fn(async () => [
      {
        messageId: 'om_q1',
        senderName: '张三',
        senderId: ASKER,
        text: '这个报错怎么解',
        createTime: '2000',
        position: 1,
      },
    ]),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
    createChat: vi.fn(async () => QA_CHAT),
    sendToChat: vi.fn(async (chatId: string, text: string) => {
      sent.push({ chatId, text })
    }),
  }

  const delivery = new QaDelivery({ repository: repositoryHarness.repository, client, seam })
  return {
    delivery,
    queued,
    reactions,
    removed,
    sent,
    settle: async (childId, stopReason) => {
      listener?.({ id: childId, ...(stopReason !== undefined ? { stopReason } : {}) })
      // The listener is fire-and-forget; give its async work a turn to land.
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

describe('delivering a QA question', () => {
  it('queues the question as a child turn and marks it in progress', async () => {
    harness = await openPetHarness()
    const f = await build(harness)

    const outcome = await f.delivery.deliver(event(), '这个报错怎么解', qaBinding())

    expect(outcome.kind).toBe('accepted')
    expect(f.queued).toHaveLength(1)
    expect(f.queued[0]?.childId).toBe(CHILD)
    expect(f.queued[0]?.parentId).toBe(PARENT)
    // The asker is named to the child, and the reply target is stated.
    expect(f.queued[0]?.text).toContain('张三')
    expect(f.queued[0]?.text).toContain(QA_CHAT)
    expect(f.queued[0]?.text).toContain('这个报错怎么解')
    // Marked BEFORE queuing: a fast turn can settle inside the queue call.
    expect(f.reactions).toEqual([{ messageId: 'om_q1', emoji: 'OnIt' }])
  })

  it('records the reply binding before queuing', async () => {
    harness = await openPetHarness()
    const f = await build(harness)

    const outcome = await f.delivery.deliver(event(), 'q', qaBinding())

    const stored =
      outcome.kind === 'accepted'
        ? harness.repository.getInvocationChannel(outcome.invocationId)
        : undefined
    expect(stored?.chatId).toBe(QA_CHAT)
    expect(stored?.triggerMessageId).toBe('om_q1')
    expect(stored?.senderOpenId).toBe(ASKER)
    // Not settled by acceptance: only a settlement event may set this.
    expect(stored?.settledAt).toBeUndefined()
  })

  it('resumes a parent that is no longer resident', async () => {
    harness = await openPetHarness()
    const f = await build(harness, { resident: false })

    const outcome = await f.delivery.deliver(event(), 'q', qaBinding())

    // The midnight path: the source session stopped being resident hours ago,
    // and the question still has to reach the child.
    expect(outcome.kind).toBe('accepted')
    expect(f.queued).toHaveLength(1)
  })

  it('reports a failed queue without invalidating the binding', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding(qaBinding())
    const f = await build(harness, { queueFails: new Error('inbox refused') })

    const outcome = await f.delivery.deliver(event(), 'q', qaBinding())

    expect(outcome.kind).toBe('error')
    // A transient inbox failure is not a dead source session: the asker sees
    // a failure mark and the next question tries again.
    expect(harness.repository.getChatBinding(QA_CHAT)?.qaInvalidatedAt).toBeUndefined()
    expect(f.reactions.map(entry => entry.emoji)).toEqual(['OnIt', 'CRY'])
  })
})

describe('settling a QA turn', () => {
  it('replaces the working mark with a done mark', async () => {
    harness = await openPetHarness()
    const f = await build(harness)
    await f.delivery.deliver(event(), 'q', qaBinding())
    await harness.repository.putChatBinding(qaBinding())

    await f.settle(CHILD, 'completed')

    expect(f.removed).toEqual(['reaction-1'])
    expect(f.reactions.map(entry => entry.emoji)).toEqual(['OnIt', 'DONE'])
  })

  it('marks a failed stop reason as failed', async () => {
    harness = await openPetHarness()
    const f = await build(harness)
    await f.delivery.deliver(event(), 'q', qaBinding())
    await harness.repository.putChatBinding(qaBinding())

    await f.settle(CHILD, 'error')

    expect(f.reactions.map(entry => entry.emoji)).toEqual(['OnIt', 'CRY'])
  })

  it('settles queued questions in arrival order', async () => {
    harness = await openPetHarness()
    const f = await build(harness)
    await harness.repository.putChatBinding(qaBinding())
    const first = await f.delivery.deliver(event({ message_id: 'om_q1' }), 'one', qaBinding())
    const second = await f.delivery.deliver(event({ message_id: 'om_q2' }), 'two', qaBinding())

    await f.settle(CHILD, 'completed')

    // FIFO: the child's inbox runs them in order, so the first settlement
    // belongs to the first question — not the most recent one.
    const firstId = first.kind === 'accepted' ? first.invocationId : ''
    const secondId = second.kind === 'accepted' ? second.invocationId : ''
    expect(harness.repository.getInvocationChannel(firstId)?.settledAt).toBeDefined()
    expect(harness.repository.getInvocationChannel(secondId)?.settledAt).toBeUndefined()
  })

  it('ignores a settlement for a child that is not a QA group', async () => {
    harness = await openPetHarness()
    const f = await build(harness)
    await f.delivery.deliver(event(), 'q', qaBinding())
    await harness.repository.putChatBinding(qaBinding())

    await f.settle('session-someone-elses-subagent', 'completed')

    // The host emits this for every subagent, including ones the user started
    // themselves; reacting to those would decorate unrelated messages.
    expect(f.reactions.map(entry => entry.emoji)).toEqual(['OnIt'])
  })

  it('ignores a settlement with nothing pending', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding(qaBinding())
    const f = await build(harness)

    // The owner talking to the child directly in the GUI, or the creation
    // seed turn: no delivery to mark, and marking anything would be wrong.
    await f.settle(CHILD, 'completed')

    expect(f.reactions).toHaveLength(0)
    expect(f.removed).toHaveLength(0)
  })
})

describe('a QA binding whose source session is gone', () => {
  it('invalidates and tells the group exactly once', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding(qaBinding())
    const f = await build(harness, { resident: false, resumeFails: true })

    const first = await f.delivery.deliver(event(), 'q', qaBinding())

    expect(first.kind).toBe('ignored')
    const invalidated = harness.repository.getChatBinding(QA_CHAT)
    expect(invalidated?.qaInvalidatedAt).toBeDefined()
    // Unlike every other refusal in this channel, this one speaks: the bot
    // has been answering here publicly, so silence would just look broken.
    expect(f.sent).toHaveLength(1)
    expect(f.sent[0]?.chatId).toBe(QA_CHAT)

    // A second question after invalidation stays silent — bounded, not spammy.
    const second = await f.delivery.deliver(
      event({ message_id: 'om_q2' }),
      'q2',
      invalidated as never,
    )

    expect(second.kind).toBe('ignored')
    expect(f.sent).toHaveLength(1)
  })

  it('keeps the child pointer so its history stays readable', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding(qaBinding())
    const f = await build(harness, { resident: false, resumeFails: true })

    await f.delivery.deliver(event(), 'q', qaBinding())

    expect(harness.repository.getChatBinding(QA_CHAT)?.qaChildSessionId).toBe(CHILD)
  })

  it('records the invalidation even when the notice cannot be sent', async () => {
    harness = await openPetHarness()
    await harness.repository.putChatBinding(qaBinding())
    const f = await build(harness, { resident: false, resumeFails: true })
    vi.spyOn(
      (f.delivery as unknown as { deps: { client: LarkClient } }).deps.client,
      'sendToChat',
    ).mockRejectedValueOnce(new Error('lark down'))

    await f.delivery.deliver(event(), 'q', qaBinding())

    // Fail-soft: a Lark outage must not stop the binding from being recorded
    // as unusable, or the group would keep raising work against a dead source.
    expect(harness.repository.getChatBinding(QA_CHAT)?.qaInvalidatedAt).toBeDefined()
  })
})
