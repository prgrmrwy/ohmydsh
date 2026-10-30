import { afterEach, expect, test } from 'vitest'
import type { FetchRegistration } from '../src/host/routes.js'
import { registerRoutes } from '../src/host/routes.js'
import { LatencyController, type Measure } from '../src/host/latency.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { SettingsStore } from '../src/host/settings.js'
import { credentialsMock } from './support/credentials.js'
import { LINE_ID, LINE_ID_2, line, memoryStore, seedKey } from './support/line.js'
import { createGateway, createTcpListener, json } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })

/** Runtime whose lines are already persisted; keys are seeded on the derived refs. */
function runtimeWith(lines: ReturnType<typeof line>[]) {
  const credentials = credentialsMock()
  for (const entry of lines) seedKey(credentials, `K-${entry.id}`, entry.id)
  const store = memoryStore(lines)
  const runtime = new MagpieRuntime(credentials.service, store, () => {})
  cleanup.push(() => runtime.dispose())
  return { runtime, store }
}

function register(runtime: MagpieRuntime) {
  const routes: FetchRegistration[] = []
  const registered = registerRoutes({ register: route => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } } }, runtime)
  cleanup.push(async () => registered.dispose())
  return { routes, registered }
}

const latencyRoute = (routes: FetchRegistration[]) => routes.find(route => route.path === '/api/dsh-magpie-connector/latency')!

test('test_latency_response_and_get_only', async () => {
  const first = await createTcpListener(); cleanup.push(first.close)
  const second = await createTcpListener(); cleanup.push(second.close)
  const { runtime } = runtimeWith([
    line(`http://127.0.0.1:${first.port}/v1`, LINE_ID),
    line(`http://127.0.0.1:${second.port}/v1`, LINE_ID_2),
    line('', '0badf00d'),
  ])
  const { routes } = register(runtime)
  const route = latencyRoute(routes)
  expect(route.methods).toEqual(['GET'])
  const response = await route.fetch(new Request('http://local/api/dsh-magpie-connector/latency'))
  expect(response.status).toBe(200)
  const body = await response.json() as { lines: { id: string; ms: number | null }[] }
  expect(body.lines).toHaveLength(2)
  expect(body.lines.map(entry => entry.id).sort()).toEqual([LINE_ID, LINE_ID_2].sort())
  for (const entry of body.lines) {
    expect(Number.isInteger(entry.ms)).toBe(true)
    expect(entry.ms!).toBeGreaterThanOrEqual(0)
  }
})

test('test_latency_empty_address_skipped', async () => {
  const calls: string[] = []
  const measure: Measure = async host => { calls.push(host); return 4 }
  const controller = new LatencyController(() => [line('', LINE_ID), line('not a url', LINE_ID_2)], { measure })
  const response = await controller.read()
  expect(await response.json()).toEqual({ lines: [] })
  expect(calls).toHaveLength(0)
})

test('test_latency_response_omits_empty', async () => {
  const listener = await createTcpListener(); cleanup.push(listener.close)
  const measure: Measure = async () => 7
  const controller = new LatencyController(() => [
    line(`http://127.0.0.1:${listener.port}/v1`, LINE_ID),
    line('', LINE_ID_2),
  ], { measure })
  const response = await controller.read()
  expect(await response.json()).toEqual({ lines: [{ id: LINE_ID, ms: 7 }] })
})

test('test_latency_single_flight', async () => {
  const listener = await createTcpListener(); cleanup.push(listener.close)
  const gates: (() => void)[] = []
  let calls = 0
  const measure: Measure = () => { calls++; return new Promise<number>(resolve => gates.push(() => resolve(11))) }
  const controller = new LatencyController(() => [line(`http://127.0.0.1:${listener.port}/v1`, LINE_ID)], { measure })
  const first = controller.read()
  const second = controller.read()
  await Promise.resolve()
  expect(calls).toBe(1)
  for (const open of gates) open()
  const [a, b] = await Promise.all([first, second])
  expect(await a.json()).toEqual({ lines: [{ id: LINE_ID, ms: 11 }] })
  expect(await b.json()).toEqual({ lines: [{ id: LINE_ID, ms: 11 }] })
})

test('test_latency_dispose', async () => {
  const listener = await createTcpListener(); cleanup.push(listener.close)
  let aborted = 0
  const measure: Measure = (_host, _port, _timeout, signal) => new Promise<number | null>(resolve => {
    signal?.addEventListener('abort', () => { aborted++; resolve(null) }, { once: true })
  })
  const controller = new LatencyController(() => [line(`http://127.0.0.1:${listener.port}/v1`, LINE_ID)], { measure })
  const pending = controller.read()
  await Promise.resolve()
  controller.dispose()
  expect(await (await pending).json()).toEqual({ lines: [{ id: LINE_ID, ms: null }] })
  expect(aborted).toBe(1)
  const after = await controller.read()
  expect(await after.json()).toEqual({ lines: [] })
  expect(aborted).toBe(1)
})

test('test_latency_no_side_effects', async () => {
  const probes: string[] = []
  const credentials = credentialsMock()
  for (const id of [LINE_ID, LINE_ID_2]) seedKey(credentials, `K-${id}`, id)
  const store = memoryStore([
    line('http://127.0.0.1:1/v1', LINE_ID),
    line('http://127.0.0.1:2/v1', LINE_ID_2),
  ])
  const runtime = new MagpieRuntime(credentials.service, store, () => {}, {
    probe: async (host, port) => { probes.push(`${host}:${port}`); return true },
  })
  cleanup.push(() => runtime.dispose())
  const before = JSON.stringify(store.value)
  const controller = new LatencyController(() => runtime.config(), { measure: async () => 3 })
  await controller.read()
  expect(JSON.stringify(store.value)).toBe(before)
  expect(runtime.selectedLineId).toBe(null)
  expect(probes).toHaveLength(0)
  const op = await runtime.beginOperation()
  op.release()
  expect(probes.length).toBeGreaterThan(0)
  expect(runtime.selectedLineId).toBe(LINE_ID)
})

test('test_latency_route_measures_saved_lines_only', async () => {
  const gateway = await createGateway(); cleanup.push(gateway.close)
  gateway.handlers.set('GET /v1/models', json({ data: [{ id: 'codex/responses', owned_by: 'codex' }] }))
  const { runtime } = runtimeWith([line(gateway.baseUrl, LINE_ID), line('', LINE_ID_2)])
  const { routes } = register(runtime)
  const response = await latencyRoute(routes).fetch(new Request('http://local/api/dsh-magpie-connector/latency'))
  const body = await response.json() as { lines: { id: string; ms: number | null }[] }
  expect(body.lines).toHaveLength(1)
  expect(body.lines[0]).toMatchObject({ id: LINE_ID })
  expect(gateway.requests).toHaveLength(0)
})

test('test_latency_single_line', async () => {
  const first = await createTcpListener(); cleanup.push(first.close)
  const second = await createTcpListener(); cleanup.push(second.close)
  const { runtime } = runtimeWith([
    line(`http://127.0.0.1:${first.port}/v1`, LINE_ID),
    line(`http://127.0.0.1:${second.port}/v1`, LINE_ID_2),
  ])
  const { routes } = register(runtime)
  const route = latencyRoute(routes)
  const measured: number[] = []
  for (const listener of [first, second]) measured.push(listener.port)

  // ?line=<id> measures only that saved line and answers with just that reading.
  const single = await route.fetch(new Request(`http://local/api/dsh-magpie-connector/latency?line=${LINE_ID_2}`))
  expect(single.status).toBe(200)
  const body = await single.json() as { lines: { id: string; ms: number | null }[] }
  expect(body.lines.map(entry => entry.id)).toEqual([LINE_ID_2])
  expect(body.lines[0]!.ms).not.toBeNull()

  // Unknown or unsaved ids measure nothing at all.
  for (const id of ['ffffffff', 'draft-1']) {
    const missing = await route.fetch(new Request(`http://local/api/dsh-magpie-connector/latency?line=${id}`))
    expect(await missing.json()).toEqual({ lines: [] })
  }
})
