import { afterEach, expect, test, vi } from 'vitest'
import { CardsController } from '../src/host/cards.js'
import { ResetController } from '../src/host/reset.js'
import { MagpieRuntime, lineCredentialRefs, type Operation } from '../src/host/runtime.js'
import { POSITIVE_TTL_MS } from '../src/host/selection.js'
import type { ConnectionIdentity } from '../src/host/transport.js'
import { credentialsMock } from './support/credentials.js'
import { deferred } from './support/gateway.js'
import { LINE_ID, LINE_ID_2, line, memoryStore } from './support/line.js'

const NOW = Date.parse('2026-11-09T00:00:00Z')
const A = 'https://a.invalid/v1', B = 'https://b.invalid/v1'
const USER = 'reset@example.invalid'
const target = { provider: 'codex', user: USER }
const card = { ...target, windows: [{ name: '7 days', used: 85, resetsAt: new Date(NOW + 86_400_000).toISOString() }], resets: { count: 1, each: [{ id: 'local-credit', until: new Date(NOW + 86_400_000).toISOString() }] } }
const reply = () => Response.json({ data: [card] })
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); vi.restoreAllMocks() })

async function setup(multi = false, access = false) {
  let clock = NOW, reachable = 'a.invalid'
  const credentials = credentialsMock('synthetic-key-a')
  credentials.setRef(String(lineCredentialRefs(LINE_ID_2).key), 'synthetic-key-b')
  if (access) {
    credentials.setRef(String(lineCredentialRefs(LINE_ID).accessClientId), 'synthetic-access-id')
    credentials.setRef(String(lineCredentialRefs(LINE_ID).accessClientSecret), 'synthetic-access-secret')
  }
  const store = memoryStore([line(A, LINE_ID, access ? 'cloudflare' : 'direct'), ...(multi ? [line(B, LINE_ID_2)] : [])])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, { now: () => clock, probe: async host => host === reachable })
  cleanup.push(() => runtime.dispose())
  const calls: { op: ConnectionIdentity; method: string; path: string }[] = []
  const request = vi.spyOn(runtime.transport, 'request').mockImplementation(async (op, method, path) => {
    calls.push({ op, method, path })
    if (path === '/models') return Response.json({ data: [] })
    if (path.includes('codex-reset')) return Response.json({ code: 'nothing_to_reset' })
    return reply()
  })
  await runtime.start()
  const operations: Operation[] = []
  const begin = runtime.beginOperation.bind(runtime)
  vi.spyOn(runtime, 'beginOperation').mockImplementation(async () => {
    const op = await begin()
    op.release = vi.fn(op.release)
    operations.push(op)
    return op
  })
  const cards = new CardsController(runtime)
  const reset = new ResetController(runtime, cards, { now: () => clock, ticketId: () => 'confirmation' })
  await cards.get()
  const prepare = () => reset.handle({ action: 'prepare', ...target })
  const ticket = async () => {
    const response = await prepare()
    expect(response.status).toBe(200)
    const body = await response.json() as { ticket: string }
    expect(Object.keys(body).sort()).toEqual(['creditExpiresAt', 'expiresAt', 'ticket', 'weeklyUsedPercent'])
    return body.ticket
  }
  const consume = (id: string) => reset.handle({ action: 'consume', ticket: id })
  const writes = () => calls.filter(c => c.path.includes('codex-reset'))
  const switchToB = () => { reachable = 'b.invalid'; clock += POSITIVE_TTL_MS + 1 }
  const afterRead = (nth: number, change: () => void | Promise<void>) => {
    const original = cards.fresh.bind(cards)
    let reads = 0
    vi.spyOn(cards, 'fresh').mockImplementation(async (readTarget, op) => {
      const result = await original(readTarget, op)
      if (++reads === nth) { expect(result.ok).toBe(true); await change() }
      return result
    })
  }
  const released = async () => {
    await runtime.current.syncPromise
    for (const op of operations) expect(op.release).toHaveBeenCalledTimes(1)
    expect((runtime as unknown as { activeKeys: Map<string, number> }).activeKeys.size).toBe(0)
  }
  const refused = async (response: Response) => {
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'MAGPIE_RESET_TICKET_INVALID' })
    expect(writes()).toHaveLength(0)
    await released()
  }
  return { runtime, credentials, store, cards, request, calls, operations, prepare, ticket, consume, writes, switchToB, afterRead, released, refused }
}

test('final fresh and reset POST share the exact retained operation; ticket contains no identity or credential', async () => {
  const s = await setup()
  const id = await s.ticket()
  // Confirmation does not retain credentials while waiting for the person.
  await s.released()
  expect((await s.consume(id)).status).toBe(200)
  const refreshes = s.calls.filter(c => c.path.includes('/refresh'))
  expect(s.writes()).toHaveLength(1)
  expect(s.writes()[0]!.op).toBe(refreshes[1]!.op)
  expect(s.writes()[0]!.op).toMatchObject({ baseUrl: A, key: 'synthetic-key-a' })
  expect((await s.consume(id)).status).toBe(409)
  expect(s.writes()).toHaveLength(1)
  await s.released()
})

for (const change of ['probe expiry', 'address', 'key', 'key event', 'access id', 'access secret', 'access mode'] as const) {
  test(`change after final read refuses reset without replay: ${change}`, async () => {
    const access = change.startsWith('access')
    const s = await setup(change === 'probe expiry', access)
    s.afterRead(2, async () => {
      if (change === 'probe expiry') s.switchToB()
      else if (change === 'address') expect((await s.runtime.settings({ lines: [line(B)] })).status).toBe(200)
      else if (change === 'access mode') expect((await s.runtime.settings({ lines: [line(A)] })).status).toBe(200)
      else {
        const field = change === 'access id' ? 'accessClientId' : change === 'access secret' ? 'accessClientSecret' : 'key'
        const ref = lineCredentialRefs(LINE_ID)[field]
        s.credentials.setRef(String(ref), 'synthetic-rotated')
        if (change === 'key event') { s.runtime.invalidateCredential(ref); await s.runtime.syncCatalog() }
      }
    })
    const id = await s.ticket()
    await s.refused(await s.consume(id))
    expect((await s.consume(id)).status).toBe(409)
    // A rejected pre-dispatch attempt is not an uncertain spend; new confirmation works.
    await s.cards.get()
    expect((await s.consume(await s.ticket())).status).toBe(200)
    expect(s.writes()).toHaveLength(1)
    await s.released()
  })
}

for (const warm of [false, true]) test(`prepare A ticket is invalid on B, new cache warmed=${warm}`, async () => {
  const s = await setup(true)
  const id = await s.ticket()
  s.switchToB()
  if (warm) await s.cards.get()
  await s.refused(await s.consume(id))
  // Even an identical user/credit id on B cannot reuse A's authorisation.
  expect(s.calls.filter(c => c.method === 'POST' && c.op.baseUrl === B)).toHaveLength(0)
})

test('identity change during prepare produces no confirmation and releases its operation', async () => {
  const s = await setup(true)
  s.afterRead(1, s.switchToB)
  await s.refused(await s.prepare())
})

test('connection write in progress after final read refuses before credentials commit', async () => {
  const s = await setup()
  const entered = deferred(), gate = deferred()
  s.credentials.setWriteGate(async () => { entered.resolve(); await gate.promise })
  let save: Promise<Response> | undefined
  s.afterRead(2, async () => {
    save = s.runtime.settings({ lines: [{ ...line(A), key: 'next-key' }] })
    await entered.promise
  })
  try { await s.refused(await s.consume(await s.ticket())) }
  finally { gate.resolve(); await save }
})

test('failed connection write invalidates confirmation even if generation has not changed', async () => {
  const s = await setup()
  s.afterRead(2, async () => {
    expect((await s.runtime.settings({ lines: [] })).status).toBe(400)
  })
  const before = s.runtime.current
  await s.refused(await s.consume(await s.ticket()))
  expect(s.runtime.current).toBe(before)
})

test('last synchronous guard catches invalidation after asynchronous revalidation resolves', async () => {
  const s = await setup()
  const id = await s.ticket()
  const revalidate = s.runtime.revalidateOperation.bind(s.runtime)
  vi.spyOn(s.runtime, 'revalidateOperation').mockImplementationOnce(async op => {
    expect(await revalidate(op)).toBe(true)
    s.runtime.invalidateCredential(lineCredentialRefs(LINE_ID).key)
    await s.runtime.syncCatalog()
    return true
  })
  await s.refused(await s.consume(id))
})

test('dispose after final read prevents reset and releases the retained key', async () => {
  const s = await setup()
  s.afterRead(2, () => s.runtime.dispose())
  await s.refused(await s.consume(await s.ticket()))
})

test('same-card refresh gate can supply final read but cannot authorise reset after rotation', async () => {
  const s = await setup()
  const id = await s.ticket()
  const entered = deferred(), gate = deferred<Response>()
  s.request.mockImplementationOnce(async () => { entered.resolve(); return gate.promise })
  const refreshing = s.cards.refresh(target)
  await entered.promise
  const freshEntered = deferred()
  const fresh = s.cards.fresh.bind(s.cards)
  vi.spyOn(s.cards, 'fresh').mockImplementation((...args) => { const result = fresh(...args); freshEntered.resolve(); return result })
  const consuming = s.consume(id)
  try {
    await freshEntered.promise
    s.runtime.invalidateCredential(lineCredentialRefs(LINE_ID).key)
    gate.resolve(reply())
    expect((await refreshing).status).toBe(409)
    await s.refused(await consuming)
  } finally { gate.resolve(reply()); await refreshing; await consuming }
})

test('a joined successful refresh keeps its caller lease until reset dispatch', async () => {
  const s = await setup()
  const id = await s.ticket()
  const entered = deferred(), gate = deferred<Response>()
  s.request.mockImplementationOnce(async () => { entered.resolve(); return gate.promise })
  const refreshing = s.cards.refresh(target)
  await entered.promise
  const freshEntered = deferred()
  const fresh = s.cards.fresh.bind(s.cards)
  let caller: Operation | undefined
  vi.spyOn(s.cards, 'fresh').mockImplementation((readTarget, op) => { caller = op; const result = fresh(readTarget, op); freshEntered.resolve(); return result })
  const consuming = s.consume(id)
  try {
    await freshEntered.promise
    gate.resolve(reply())
    expect((await refreshing).status).toBe(200)
    expect((await consuming).status).toBe(200)
    expect(s.writes()[0]!.op).toBe(caller)
    await s.released()
  } finally { gate.resolve(reply()); await refreshing; await consuming }
})

test('failed credential revalidation is unconsumed, redacted and releases the read operation', async () => {
  const s = await setup()
  s.afterRead(2, () => { vi.spyOn(s.credentials.service, 'resolve').mockRejectedValueOnce(new Error('synthetic-key-a unavailable')) })
  const response = await s.consume(await s.ticket())
  expect(response.status).toBe(502)
  expect(await response.json()).toEqual({ outcome: 'unconsumed', error: 'MAGPIE_RESET_READ_FAILED: [redacted] unavailable' })
  expect(s.writes()).toHaveLength(0)
  await s.released()
  expect((await s.consume(await s.ticket())).status).toBe(200)
  await s.released()
})

test('a connection write while consume captures credentials invalidates its earlier ticket', async () => {
  const s = await setup()
  const id = await s.ticket()
  const entered = deferred(), gate = deferred()
  s.credentials.setResolveGate(async () => { entered.resolve(); await gate.promise })
  const consuming = s.consume(id)
  try {
    await entered.promise
    expect((await s.runtime.settings({ lines: [] })).status).toBe(400)
    gate.resolve()
    await s.refused(await consuming)
  } finally { gate.resolve(); await consuming }
})

test('credential rotation after POST starts stays uncertain, redacts the old key, and never replays', async () => {
  const s = await setup()
  const id = await s.ticket()
  const request = s.request.getMockImplementation()!
  s.request.mockImplementation(async (op, method, path, init) => {
    if (!path.includes('codex-reset')) return request(op, method, path, init)
    s.calls.push({ op, method, path })
    s.credentials.setRef(String(lineCredentialRefs(LINE_ID).key), 'new-key')
    s.runtime.invalidateCredential(lineCredentialRefs(LINE_ID).key)
    await s.runtime.syncCatalog()
    throw new Error(`Connection lost after sending ${op.key}`)
  })
  const response = await s.consume(id)
  expect(response.status).toBe(502)
  const body = await response.json() as { outcome: string; error: string }
  expect(body.outcome).toBe('uncertain')
  expect(body.error).toContain('[redacted]')
  expect(body.error).not.toContain('synthetic-key-a')
  expect((await s.prepare()).status).toBe(409)
  expect((await s.consume(id)).status).toBe(409)
  expect(s.writes()).toHaveLength(1)
  await s.released()
})
