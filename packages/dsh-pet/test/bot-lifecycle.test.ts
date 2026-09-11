import { describe, expect, it, vi } from 'vitest'
import {
  BOT_ADDED_EVENT_KEY,
  BotLifecycleIntake,
  parseBotAddedEvent,
} from '../src/host/channel/bot-lifecycle.js'

function event(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: '2.0',
    header: {
      event_type: BOT_ADDED_EVENT_KEY,
      event_id: 'evt-1',
      create_time: '1700000000000',
    },
    event: {
      chat_id: 'oc-project',
      operator_id: { open_id: 'ou-owner' },
    },
    ...overrides,
  })
}

describe('bot-added lifecycle intake', () => {
  it('parses the catalog V2 envelope and rejects missing identity fields', () => {
    expect(parseBotAddedEvent(event())).toEqual({
      type: BOT_ADDED_EVENT_KEY,
      eventId: 'evt-1',
      chatId: 'oc-project',
      operatorOpenId: 'ou-owner',
      createdAt: 1700000000000,
    })
    expect(parseBotAddedEvent('{}')).toBeUndefined()
    expect(parseBotAddedEvent(event({ header: { event_type: BOT_ADDED_EVENT_KEY } }))).toBeUndefined()
  })

  it('initializes only with allowlisted operator proof and deduplicates event ids', async () => {
    const ensureAuthorizedChat = vi.fn(async () => undefined)
    const intake = new BotLifecycleIntake({
      allowOpenIds: () => ['ou-owner'],
      initializer: { ensureAuthorizedChat },
    })
    await expect(intake.handleLine(event())).resolves.toEqual({ kind: 'initialized', eventId: 'evt-1' })
    await expect(intake.handleLine(event())).resolves.toEqual({ kind: 'duplicate', eventId: 'evt-1' })
    expect(ensureAuthorizedChat).toHaveBeenCalledTimes(1)
    expect(ensureAuthorizedChat).toHaveBeenCalledWith({
      chatId: 'oc-project', eventId: 'evt-1', operatorOpenId: 'ou-owner',
    })
  })

  it('retries the same lifecycle event after a transient initialization failure', async () => {
    const ensureAuthorizedChat = vi.fn()
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockResolvedValueOnce(undefined)
    const intake = new BotLifecycleIntake({
      allowOpenIds: () => ['ou-owner'],
      initializer: { ensureAuthorizedChat },
    })

    await expect(intake.handleLine(event())).rejects.toThrow('temporary storage failure')
    await expect(intake.handleLine(event())).resolves.toEqual({ kind: 'initialized', eventId: 'evt-1' })
    expect(ensureAuthorizedChat).toHaveBeenCalledTimes(2)
  })

  it('keeps missing or non-allowlisted authorization unverified without initialization', async () => {
    const ensureAuthorizedChat = vi.fn()
    const intake = new BotLifecycleIntake({
      allowOpenIds: () => ['ou-owner'],
      initializer: { ensureAuthorizedChat },
    })
    const missingOperator = JSON.stringify({
      schema: '2.0',
      header: { event_type: BOT_ADDED_EVENT_KEY, event_id: 'evt-missing' },
      event: { chat_id: 'oc-project' },
    })
    const outsider = JSON.stringify({
      schema: '2.0',
      header: { event_type: BOT_ADDED_EVENT_KEY, event_id: 'evt-outsider' },
      event: { chat_id: 'oc-project', operator_id: { open_id: 'ou-outsider' } },
    })
    await expect(intake.handleLine(missingOperator)).resolves.toEqual({ kind: 'unverified', eventId: 'evt-missing' })
    await expect(intake.handleLine(outsider)).resolves.toEqual({ kind: 'unverified', eventId: 'evt-outsider' })
    expect(ensureAuthorizedChat).not.toHaveBeenCalled()
  })
})
