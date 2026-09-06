/**
 * Terminal-feedback resolution, pinned to shapes observed on a real Host.
 *
 * Both behaviours here were wrong in the first real run: the reaction was
 * never cleared (so "working" and "done" piled up on one message), and the
 * direct-chat reply never went out. Neither was reachable by unit tests
 * written against assumed shapes, so these use the actual ones.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { latestAssistantText } from '../src/index.js'
import { openPetHarness, testInvocation, testTask, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('finding the Invocation awaiting terminal feedback', () => {
  it('finds a settled Invocation whose reaction is still pending', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const invocation = await repo.appendInvocation(testInvocation())
    await repo.putInvocationChannel({
      invocationId: invocation.id,
      chatId: 'oc_group0000000000000000000000000',
      chatType: 'group',
      triggerMessageId: 'om_trigger',
      senderOpenId: 'ou_owner000000000000000000000000',
      reactionId: 'reaction-1',
      createdAt: 1,
    })
    // The state a real `turn/end` arrives in: the Invocation has ALREADY
    // settled, so the serial slot is empty.
    await repo.setInvocationStatus(invocation.id, 'succeeded')
    expect(repo.findCurrentInvocation('task-1')).toBeUndefined()

    const pending = repo.findPendingChannelFeedback('task-1')

    expect(pending?.invocationId).toBe(invocation.id)
  })

  it('finds a binding whose reaction has not landed yet', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const invocation = await repo.appendInvocation(testInvocation())
    // The real race: the reaction is applied AFTER dispatch, so a fast turn
    // reaches terminal feedback while that write is still in flight. Keying
    // on "has a reaction id" missed exactly this case, leaving the working
    // mark on the message forever.
    await repo.putInvocationChannel({
      invocationId: invocation.id,
      chatId: 'oc_p2p00000000000000000000000000',
      chatType: 'p2p',
      triggerMessageId: 'om_trigger',
      senderOpenId: 'ou_owner000000000000000000000000',
      createdAt: 1,
    })

    expect(repo.findPendingChannelFeedback('task-1')?.invocationId).toBe(invocation.id)
  })

  it('reports nothing once feedback has been applied', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const invocation = await repo.appendInvocation(testInvocation())
    await repo.putInvocationChannel({
      invocationId: invocation.id,
      chatId: 'oc_group0000000000000000000000000',
      chatType: 'group',
      triggerMessageId: 'om_trigger',
      senderOpenId: 'ou_owner000000000000000000000000',
      reactionId: 'reaction-1',
      createdAt: 1,
    })

    await repo.markChannelSettled(invocation.id)

    // Settling twice would stack a second terminal reaction.
    expect(repo.findPendingChannelFeedback('task-1')).toBeUndefined()
  })

  it('ignores bindings belonging to another Task', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    await repo.putInvocationChannel({
      invocationId: 'inv-elsewhere',
      chatId: 'oc_group0000000000000000000000000',
      chatType: 'group',
      triggerMessageId: 'om_other',
      senderOpenId: 'ou_owner000000000000000000000000',
      reactionId: 'reaction-9',
      createdAt: 1,
    })

    expect(repo.findPendingChannelFeedback('task-1')).toBeUndefined()
  })

  it('picks the newest pending binding when a Task has several', async () => {
    harness = await openPetHarness()
    const repo = harness.repository
    await repo.createTask(testTask())
    const first = await repo.appendInvocation(testInvocation({ id: 'inv-old' }))
    const second = await repo.appendInvocation(testInvocation({ id: 'inv-new' }))
    for (const [invocationId, createdAt] of [
      [first.id, 1],
      [second.id, 2],
    ] as const) {
      await repo.putInvocationChannel({
        invocationId,
        chatId: 'oc_group0000000000000000000000000',
        chatType: 'group',
        triggerMessageId: `om_${invocationId}`,
        senderOpenId: 'ou_owner000000000000000000000000',
        reactionId: `reaction-${invocationId}`,
        createdAt,
      })
    }

    expect(repo.findPendingChannelFeedback('task-1')?.invocationId).toBe('inv-new')
  })
})

describe('reading the final assistant text', () => {
  /** An `assistant/message` event as a real session log records one. */
  function assistantMessage(content: readonly unknown[]): unknown {
    return {
      type: 'assistant/message',
      seq: 131,
      data: { turn: 1, step: 2, message: { role: 'assistant', content } },
    }
  }

  it('reads the text parts of the last assistant message', () => {
    const events = [
      assistantMessage([{ type: 'text', text: '第一轮' }]),
      assistantMessage([{ type: 'text', text: '大王，我是 Claude' }]),
    ]

    expect(latestAssistantText(events)).toBe('大王，我是 Claude')
  })

  it('skips reasoning and tool-call parts', () => {
    // Both sit in the same content array; neither belongs in a chat reply.
    const events = [
      assistantMessage([
        { type: 'reasoning', text: '用户在问我是什么模型…' },
        { type: 'text', text: '我是 Claude' },
        { type: 'tool-call', id: 'toolu_1', name: 'pet_context', arguments: '' },
      ]),
    ]

    const text = latestAssistantText(events)

    expect(text).toBe('我是 Claude')
    expect(text).not.toContain('用户在问我')
    expect(text).not.toContain('pet_context')
  })

  it('joins several text parts of one message', () => {
    const events = [
      assistantMessage([
        { type: 'text', text: '结论：' },
        { type: 'text', text: '缓存没命中' },
      ]),
    ]

    expect(latestAssistantText(events)).toBe('结论：\n\n缓存没命中')
  })

  it('returns undefined for a message with no readable text', () => {
    // No reply is better than an empty one.
    const events = [
      assistantMessage([{ type: 'tool-call', id: 't', name: 'bash', arguments: '' }]),
    ]

    expect(latestAssistantText(events)).toBeUndefined()
  })

  it('ignores user messages and other event types', () => {
    const events = [
      { type: 'user/message', data: { content: [{ type: 'text', text: '你是什么模型' }] } },
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    ]

    expect(latestAssistantText(events)).toBeUndefined()
  })

  it('returns undefined for an empty log', () => {
    expect(latestAssistantText([])).toBeUndefined()
  })
})
