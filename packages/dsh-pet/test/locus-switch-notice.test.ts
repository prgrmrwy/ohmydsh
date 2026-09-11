import { describe, expect, it, vi } from 'vitest'
import {
  createSwitchNotices,
  type SwitchNotice,
  type SwitchNoticeDiagnostic,
  type SwitchNoticeStore,
} from '../src/host/locus/switch-notice.js'

const ENDPOINT = { chatId: 'oc-project' } as const
const LOCUS = 'locus-2'
const GENERATION = 2

/** In-memory store with the durable semantics the real one must have. */
function memoryStore(seed: readonly SwitchNotice[] = []): SwitchNoticeStore & {
  readonly rows: Map<string, SwitchNotice>
} {
  const rows = new Map<string, SwitchNotice>()
  for (const item of seed) rows.set(`${item.locusId}#${String(item.generation)}`, item)
  const key = (locusId: string, generation: number) => `${locusId}#${String(generation)}`
  return {
    rows,
    put: async (notice) => { rows.set(key(notice.locusId, notice.generation), notice) },
    find: (locusId, generation) => rows.get(key(locusId, generation)),
    list: () => [...rows.values()],
    clear: async (locusId, generation) => { rows.delete(key(locusId, generation)) },
    recordFailure: async (locusId, generation, error) => {
      const current = rows.get(key(locusId, generation))
      if (current === undefined) return
      rows.set(key(locusId, generation), {
        ...current,
        attempts: current.attempts + 1,
        lastError: error,
      })
    },
  }
}

function harness(options: {
  readonly store?: ReturnType<typeof memoryStore>
  readonly send?: (input: { endpoint: unknown; text: string }) => Promise<void>
  readonly sender?: boolean
} = {}) {
  const store = options.store ?? memoryStore()
  const sent: string[] = []
  const diagnostics: SwitchNoticeDiagnostic[] = []
  const notices = createSwitchNotices({
    store,
    ...(options.sender === false
      ? {}
      : {
        sender: {
          send: options.send ?? (async ({ text }) => { sent.push(text) }),
        },
      }),
    now: () => 1_000,
    log: code => { diagnostics.push(code) },
  })
  return { notices, store, sent, diagnostics }
}

const TEXT = '当前入口已从「S0」切换到「S1」；上下文来源发生变化，旧对话历史未自动合并。'

describe('durable source-switch notices', () => {
  it('records the notice so a restart cannot lose it', async () => {
    const h = harness()

    await h.notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })

    expect(h.store.find(LOCUS, GENERATION)).toMatchObject({
      locusId: LOCUS,
      generation: GENERATION,
      text: TEXT,
      attempts: 0,
    })
    expect(h.diagnostics).toEqual(['notice-recorded'])
  })

  it('blocks ordinary dispatch while the notice is owed', async () => {
    const h = harness()
    await h.notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })

    // Dispatching here is the silent switch the spec forbids: the entry would
    // get an answer from a different source without ever being told.
    expect(h.notices.gate(LOCUS, GENERATION)).toEqual({
      allowed: false,
      reason: 'switch-notice-pending',
    })

    await h.notices.flush(LOCUS, GENERATION)
    expect(h.notices.gate(LOCUS, GENERATION)).toEqual({ allowed: true })
  })

  it('allows dispatch for a generation that owes nothing', () => {
    // An ordinary generation was never switched, so it must not be gated.
    expect(harness().notices.gate('locus-untouched', 1)).toEqual({ allowed: true })
  })

  it('clears the debt only after the send actually succeeded', async () => {
    const failure = new Error('chat unreachable')
    const h = harness({ send: async () => { throw failure } })
    await h.notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })

    await expect(h.notices.flush(LOCUS, GENERATION)).resolves.toBe(false)

    // Still owed, with the failure recorded, and still blocking dispatch.
    expect(h.store.find(LOCUS, GENERATION)).toMatchObject({
      attempts: 1,
      lastError: 'chat unreachable',
    })
    expect(h.notices.gate(LOCUS, GENERATION).allowed).toBe(false)
    expect(h.diagnostics).toContain('notice-send-failed')
  })

  it('delivers on a later retry and then stops resending', async () => {
    let failNext = true
    const h = harness({
      send: async ({ text }) => {
        if (failNext) { failNext = false; throw new Error('transient') }
        h.sent.push(text)
      },
    })
    await h.notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })

    await expect(h.notices.flush(LOCUS, GENERATION)).resolves.toBe(false)
    await expect(h.notices.flush(LOCUS, GENERATION)).resolves.toBe(true)
    // A retry after delivery must not post a second copy into the entry.
    await expect(h.notices.flush(LOCUS, GENERATION)).resolves.toBe(true)

    expect(h.sent).toEqual([TEXT])
  })

  it('keeps work blocked when no sender is composed', async () => {
    const h = harness({ sender: false })
    await h.notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })

    await expect(h.notices.flush(LOCUS, GENERATION)).resolves.toBe(false)

    // Without a way to announce the switch, the new source must stay silent
    // rather than answer unannounced.
    expect(h.notices.gate(LOCUS, GENERATION).allowed).toBe(false)
    expect(h.diagnostics).toContain('notice-sender-unavailable')
  })
})

describe('the durable store survives a restart', () => {
  it('keeps an undelivered notice across reopening the medium', async () => {
    const { createDurableSwitchNoticeStore } = await import('../src/host/locus/switch-notice.js')
    const { emptyMedium, openPetHarness } = await import('./harness.js')
    const medium = emptyMedium()

    const first = await openPetHarness(medium)
    const notices = createSwitchNotices({
      store: createDurableSwitchNoticeStore(first.domain as never),
      // No sender: the notice must stay owed.
      now: () => 5,
    })
    await notices.record({ locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT, text: TEXT })
    await first.close()

    // A crash between publishing the switch and announcing it must not lose
    // the debt, or the new source would answer unannounced after restart.
    const second = await openPetHarness(medium)
    const sent: string[] = []
    const restarted = createSwitchNotices({
      store: createDurableSwitchNoticeStore(second.domain as never),
      sender: { send: async ({ text }) => { sent.push(text) } },
    })
    expect(restarted.gate(LOCUS, GENERATION).allowed).toBe(false)

    await expect(restarted.flushAll()).resolves.toEqual({ delivered: 1, pending: 0 })
    expect(sent).toEqual([TEXT])
    expect(restarted.gate(LOCUS, GENERATION)).toEqual({ allowed: true })
    await second.close()
  })

  it('does not resurrect a delivered notice from a late failure report', async () => {
    const { createDurableSwitchNoticeStore } = await import('../src/host/locus/switch-notice.js')
    const { openPetHarness } = await import('./harness.js')
    const host = await openPetHarness()
    const store = createDurableSwitchNoticeStore(host.domain as never)

    await store.put({
      locusId: LOCUS, generation: GENERATION, endpoint: ENDPOINT,
      text: TEXT, createdAt: 1, attempts: 0,
    })
    await store.clear(LOCUS, GENERATION)
    await store.recordFailure(LOCUS, GENERATION, 'late report')

    // Recording a failure for a cleared notice would re-block an endpoint
    // whose switch was already announced.
    expect(store.find(LOCUS, GENERATION)).toBeUndefined()
    expect(store.list()).toEqual([])
    await host.close()
  })
})

describe('restart recovery', () => {
  it('delivers every notice still owed after a restart', async () => {
    const store = memoryStore([
      {
        locusId: 'locus-a', generation: 2, endpoint: ENDPOINT,
        text: 'A', createdAt: 1, attempts: 0,
      },
      {
        locusId: 'locus-b', generation: 3, endpoint: { chatId: 'oc-other' },
        text: 'B', createdAt: 1, attempts: 1, lastError: 'earlier failure',
      },
    ])
    const h = harness({ store })

    const result = await h.notices.flushAll()

    expect(result).toEqual({ delivered: 2, pending: 0 })
    expect(h.sent.sort()).toEqual(['A', 'B'])
    expect(store.rows.size).toBe(0)
  })

  it('reports what is still pending when delivery keeps failing', async () => {
    const store = memoryStore([
      { locusId: 'locus-a', generation: 2, endpoint: ENDPOINT, text: 'A', createdAt: 1, attempts: 0 },
      { locusId: 'locus-b', generation: 3, endpoint: ENDPOINT, text: 'B', createdAt: 1, attempts: 0 },
    ])
    let first = true
    const h = harness({
      store,
      send: async ({ text }) => {
        if (first) { first = false; h.sent.push(text as string); return }
        throw new Error('still down')
      },
    })

    const result = await h.notices.flushAll()

    // A partial recovery is reported honestly, and the undelivered notice
    // keeps its endpoint blocked.
    expect(result).toEqual({ delivered: 1, pending: 1 })
    expect(store.rows.size).toBe(1)
  })

  it('treats each generation independently', async () => {
    const h = harness()
    await h.notices.record({ locusId: LOCUS, generation: 2, endpoint: ENDPOINT, text: 'gen 2' })
    await h.notices.record({ locusId: LOCUS, generation: 3, endpoint: ENDPOINT, text: 'gen 3' })

    await h.notices.flush(LOCUS, 2)

    // Delivering one generation's notice must not silently satisfy another's.
    expect(h.notices.gate(LOCUS, 2)).toEqual({ allowed: true })
    expect(h.notices.gate(LOCUS, 3).allowed).toBe(false)
  })
})
