import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_TTL_MS,
  PairingController,
  generatePairingCode,
} from '../src/host/channel/pairing.js'
import type { LarkInboundEvent } from '../src/host/channel/event.js'
import type { LarkClient } from '../src/host/channel/lark.js'
import { emptyMedium, openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

const OPEN_ID = 'ou_pairing0000000000000000000000'
const CHAT_ID = 'oc_pairing0000000000000000000000'

function event(overrides: Partial<LarkInboundEvent> = {}): LarkInboundEvent {
  return {
    type: 'im.message.receive_v1',
    message_id: 'om_pairing',
    chat_id: CHAT_ID,
    chat_type: 'p2p',
    message_type: 'text',
    content: '/pair 2345-6789',
    create_time: '1000',
    sender_id: OPEN_ID,
    sender_type: 'user',
    ...overrides,
  }
}

function client(options: { replyFails?: boolean; name?: string } = {}): LarkClient {
  return {
    addReaction: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    listMessages: vi.fn(async () => [
      {
        messageId: 'om_pairing',
        senderName: options.name ?? '配对用户',
        text: '',
        createTime: '1000',
        position: 1,
      },
    ]),
    listChatBots: vi.fn(async () => []),
    chatName: vi.fn(async () => undefined),
    botReady: vi.fn(async () => true),
    reply: vi.fn(async () => undefined),
    replyStrict: vi.fn(async () => {
      if (options.replyFails === true) throw new Error('offline')
    }),
  }
}

async function fixture(options: { failWrites?: boolean; replyFails?: boolean } = {}) {
  const medium = emptyMedium()
  const created = await openPetHarness(
    medium,
    options.failWrites === true ? { failWrites: new Error('disk full') } : {},
  )
  harness = created
  let now = 1_000
  const timers: { fn: () => void; ms: number }[] = []
  const logs: string[] = []
  const changes: number[] = []
  const lark = client({ replyFails: options.replyFails })
  let randomCall = 0
  const pairing = new PairingController({
    repository: created.repository,
    client: lark,
    now: () => now,
    randomBytes: () => {
      const offset = randomCall++ * 8
      return Uint8Array.from(Array.from({ length: 8 }, (_, index) => offset + index))
    },
    schedule: (fn, ms) => {
      timers.push({ fn, ms })
      return { unref: () => undefined } as unknown as ReturnType<typeof setTimeout>
    },
    onChange: () => changes.push(now),
    log: reason => logs.push(reason),
  })
  return {
    pairing,
    lark,
    medium,
    timers,
    logs,
    changes,
    setNow: (value: number) => { now = value },
  }
}

describe('pairing code', () => {
  it('uses exactly 32 unambiguous symbols and maps all bytes', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32)
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(32)
    for (const byte of Array.from({ length: 256 }, (_, index) => index)) {
      const code = generatePairingCode(Uint8Array.from(Array(8).fill(byte)))
      expect(code).toMatch(/^[23456789a-z]{4}-[23456789a-z]{4}$/)
      expect(code).not.toContain('undefined')
    }
  })

  it('does not expose the command before activation and expires after five minutes', async () => {
    const f = await fixture()
    f.pairing.start()
    expect(f.pairing.publicState).toEqual({ phase: 'starting' })

    f.pairing.activate()
    expect(f.pairing.publicState).toEqual({
      phase: 'waiting',
      command: '/pair 2345-6789',
      expiresAt: 1_000 + PAIRING_TTL_MS,
    })
    expect(f.timers[0]?.ms).toBe(PAIRING_TTL_MS)

    f.timers[0]?.fn()
    expect(f.pairing.publicState).toEqual({ phase: 'expired' })
    expect(f.pairing.requiresConsumer).toBe(false)
  })

  it('cancel, replacement and stop invalidate the old code', async () => {
    const f = await fixture()
    f.pairing.start()
    f.pairing.activate()
    f.pairing.start()
    f.pairing.activate()

    expect(await f.pairing.handle(event())).toBe(true)
    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([])

    f.pairing.cancel()
    expect(f.pairing.publicState).toBeUndefined()
    f.pairing.start()
    f.pairing.stop()
    expect(f.pairing.publicState).toBeUndefined()
  })
})

describe('pairing admission and commit', () => {
  it.each([
    ['group', { chat_type: 'group' as const }],
    ['bot sender', { sender_type: 'bot' }],
    ['non-text', { message_type: 'image' }],
    ['bad id', { sender_id: 'user-1' }],
    ['extra args', { content: '/pair 2345-6789 now' }],
    ['wrong case', { content: '/PAIR 2345-6789' }],
    ['wrong code', { content: '/pair aaaa-bbbb' }],
    ['old event', { create_time: '999' }],
    ['missing timestamp', { create_time: undefined }],
    ['malformed timestamp', { create_time: 'not-a-number' }],
    ['zero timestamp', { create_time: '0' }],
    ['negative timestamp', { create_time: '-1' }],
  ])('silently consumes invalid %s attempts without authorization', async (_name, overrides) => {
    const f = await fixture()
    f.pairing.start()
    f.pairing.activate()

    expect(await f.pairing.handle(event(overrides))).toBe(
      String(overrides.content ?? '/pair 2345-6789').toLowerCase().startsWith('/pair'),
    )
    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([])
    expect(f.lark.replyStrict).not.toHaveBeenCalled()
    expect(f.pairing.publicState?.phase).toBe('waiting')
  })

  it('atomically adds one claimant, caches the name and replies after commit', async () => {
    const f = await fixture()
    await harness?.repository.putChannelConfig({
      enabled: false,
      allowOpenIds: ['ou_existing000000000000000000000'],
      updatedAt: 1,
    })
    f.pairing.start()
    f.pairing.activate()

    const [first, second] = await Promise.all([
      f.pairing.handle(event()),
      f.pairing.handle(event({ message_id: 'om_second', sender_id: 'ou_second0000000000000000000000' })),
    ])

    expect(first).toBe(true)
    expect(second).toBe(true)
    const config = harness?.repository.getChannelConfig()
    expect(config?.allowOpenIds).toEqual(['ou_existing000000000000000000000', OPEN_ID])
    expect(config?.knownNames?.[OPEN_ID]).toBe('配对用户')
    expect(f.pairing.publicState).toEqual({ phase: 'succeeded', openId: OPEN_ID, name: '配对用户' })
    expect(f.lark.replyStrict).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(f.medium)).not.toContain('2345-6789')
  })

  it('refuses cancel while a claimed member is being committed', async () => {
    const f = await fixture()
    const repository = harness!.repository
    const originalPut = repository.putChannelConfig.bind(repository)
    let releaseWrite: (() => void) | undefined
    let enteredWrite: (() => void) | undefined
    const writeEntered = new Promise<void>(resolve => { enteredWrite = resolve })
    const writeRelease = new Promise<void>(resolve => { releaseWrite = resolve })
    vi.spyOn(repository, 'putChannelConfig').mockImplementation(async config => {
      enteredWrite?.()
      await writeRelease
      return originalPut(config)
    })
    f.pairing.start()
    f.pairing.activate()

    const claiming = f.pairing.handle(event())
    await writeEntered
    expect(f.pairing.cancel()).toBe(false)
    expect(f.pairing.fail('subscription down')).toBe(false)
    expect(f.pairing.stop()).toBe(false)
    expect(f.pairing.publicState?.phase).toBe('claiming')
    releaseWrite?.()
    await claiming

    expect(repository.getChannelConfig().allowOpenIds).toEqual([OPEN_ID])
    expect(f.pairing.publicState?.phase).toBe('succeeded')
  })

  it('authorizes without a display name and preserves authorization when receipt fails', async () => {
    const f = await fixture({ replyFails: true })
    vi.mocked(f.lark.listMessages).mockRejectedValue(new Error('history unavailable'))
    f.pairing.start()
    f.pairing.activate()

    await f.pairing.handle(event())

    expect(harness?.repository.getChannelConfig().allowOpenIds).toEqual([OPEN_ID])
    expect(f.pairing.publicState).toEqual({ phase: 'succeeded', openId: OPEN_ID })
    expect(f.logs).toEqual(['pairing-reply-failed'])
  })

  it('reports storage failure without a success receipt or leaked command', async () => {
    const f = await fixture({ failWrites: true })
    f.pairing.start()
    f.pairing.activate()

    await f.pairing.handle(event())

    expect(f.pairing.publicState).toEqual({
      phase: 'failed',
      diagnostic: '无法保存允许成员，请重新生成配对码。',
    })
    expect(f.lark.replyStrict).not.toHaveBeenCalled()
    expect(JSON.stringify(f.pairing.publicState)).not.toContain('2345-6789')
  })
})
