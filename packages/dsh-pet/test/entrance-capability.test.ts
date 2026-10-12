import { describe, expect, it, vi } from 'vitest'

import {
  ENTRANCE_PROBE_DEADLINE_MS,
  describeEntranceReadability,
  measureEntranceReadability,
  type EntranceReadability,
} from '../src/host/channel/entrance-capability.js'

const chatId = 'oc_probe'

function controller(): AbortController {
  return new AbortController()
}

describe('measureEntranceReadability', () => {
  it('reports readable only after a real successful read of this entrance', async () => {
    const seen: unknown[] = []
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {
        probe: async input => {
          seen.push(input)
          return true
        },
      },
    )

    expect(state).toBe<EntranceReadability>('readable')
    expect(seen).toEqual([{ chatId, signal: expect.anything() }])
  })

  it('passes the bound topic through to the probe', async () => {
    const seen: { chatId: string; threadId?: string }[] = []
    await measureEntranceReadability(
      { chatId, threadId: 'omt_topic', signal: controller().signal },
      {
        probe: async input => {
          seen.push({ chatId: input.chatId, threadId: input.threadId })
          return true
        },
      },
    )

    expect(seen).toEqual([{ chatId, threadId: 'omt_topic' }])
  })

  it('reports unreadable when the probe answers false', async () => {
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      { probe: async () => false },
    )

    expect(state).toBe<EntranceReadability>('unreadable')
  })

  it('reports unreadable when the probe throws instead of failing open', async () => {
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {
        probe: async () => {
          throw new Error('user_unauthorized')
        },
      },
    )

    expect(state).toBe<EntranceReadability>('unreadable')
  })

  it('cannot claim readability without any probe at all', async () => {
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {},
    )

    expect(state).toBe<EntranceReadability>('unconfirmed')
  })

  it('degrades a probe that exceeds the bounded deadline to unconfirmed', async () => {
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {
        probe: () => new Promise<boolean>(() => {}),
        deadlineMs: 10,
      },
    )

    expect(state).toBe<EntranceReadability>('unconfirmed')
  })

  it('never adopts a late success once the deadline has expired', async () => {
    let release: ((value: boolean) => void) | undefined
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {
        probe: () => new Promise<boolean>(resolve => {
          release = resolve
        }),
        deadlineMs: 10,
      },
    )

    expect(state).toBe<EntranceReadability>('unconfirmed')
    release?.(true)
    await Promise.resolve()
    // The measurement is already final; a late result must not rewrite it.
    expect(state).toBe<EntranceReadability>('unconfirmed')
  })

  it('discards the measurement when the delivery is aborted first', async () => {
    const abort = controller()
    const pending = measureEntranceReadability(
      { chatId, signal: abort.signal },
      {
        probe: () => new Promise<boolean>(() => {}),
        deadlineMs: 60_000,
      },
    )
    abort.abort()

    expect(await pending).toBe<EntranceReadability>('unconfirmed')
  })

  it('does not even start a probe for an already-aborted delivery', async () => {
    const abort = controller()
    abort.abort()
    const probe = vi.fn(async () => true)

    const state = await measureEntranceReadability({ chatId, signal: abort.signal }, { probe })

    expect(state).toBe<EntranceReadability>('unconfirmed')
    expect(probe).not.toHaveBeenCalled()
  })

  it('tolerates a late rejection without an unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown): void => {
      rejections.push(reason)
    }
    process.on('unhandledRejection', onRejection)
    try {
      let fail: ((reason: Error) => void) | undefined
      const state = await measureEntranceReadability(
        { chatId, signal: controller().signal },
        {
          probe: () => new Promise<boolean>((_resolve, reject) => {
            fail = reject
          }),
          deadlineMs: 10,
        },
      )
      fail?.(new Error('late failure'))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(state).toBe<EntranceReadability>('unconfirmed')
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('honours the documented default deadline', () => {
    expect(ENTRANCE_PROBE_DEADLINE_MS).toBeGreaterThan(0)
    expect(ENTRANCE_PROBE_DEADLINE_MS).toBeLessThanOrEqual(20_000)
  })

  it('measures again on every call instead of reusing the previous verdict', async () => {
    let readable = true
    const state = async (): Promise<EntranceReadability> => measureEntranceReadability(
      { chatId, signal: controller().signal },
      { probe: async () => readable },
    )

    expect(await state()).toBe<EntranceReadability>('readable')
    // A cached verdict would keep declaring a capability the entrance lost.
    readable = false
    expect(await state()).toBe<EntranceReadability>('unreadable')
  })

  it('escapes as a bare verdict, never as the content it read', async () => {
    const state = await measureEntranceReadability(
      { chatId, signal: controller().signal },
      {
        // A real probe does read a page; only success/failure may come back.
        probe: async () => JSON.stringify({ messages: [{ text: '群内正文' }] }).length > 0,
      },
    )

    expect(JSON.stringify(state)).toBe('"readable"')
  })
})

describe('describeEntranceReadability', () => {
  it('declares readability only for the measured readable state', () => {
    expect(describeEntranceReadability('readable')).toContain('已实测可读')
  })

  it('states the limit instead of a promise for the unreadable state', () => {
    const text = describeEntranceReadability('unreadable')

    expect(text).toContain('不可读')
    expect(text).not.toContain('已实测可读')
  })

  it('states the unknown state instead of a promise for the unconfirmed state', () => {
    const text = describeEntranceReadability('unconfirmed')

    expect(text).toContain('未确认')
    expect(text).not.toContain('已实测可读')
  })
})
