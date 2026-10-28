import { afterEach, expect, test } from 'vitest'
import { LineSelector, type Probe } from '../src/host/selection.js'
import type { LineSettings } from '../src/host/settings.js'
import { createTcpListener, unreachableBaseUrl } from './support/gateway.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const entry of cleanup.splice(0).reverse()) await entry() })
const line = (id: string, baseUrl: string, accessMode: 'direct' | 'cloudflare' = 'direct'): LineSettings => ({ id, baseUrl, accessMode })

/** A fake probe whose verdicts depend on hostname; records every call. */
function scriptedProbe(verdict: (host: string) => boolean) {
  const calls: string[] = []
  const probe: Probe = async (host) => { calls.push(host); return verdict(host) }
  return { calls, probe }
}

test('test_line_probe_01 spec Scenario "负缓存期内不重复探测"', async () => {
  let now = 0
  const { calls, probe } = scriptedProbe(host => host === 'reachable.test')
  const selector = new LineSelector({ probe, now: () => now })
  const lines = [line('1', 'http://unreachable.test:3425/v1'), line('2', 'http://reachable.test:3425/v1')]
  await selector.select(lines)
  now = 5_000
  await selector.select(lines)
  await selector.select(lines)
  expect(calls).toEqual(['unreachable.test', 'reachable.test'])
  expect(await selector.select(lines)).toEqual(lines[1])
})

test('test_line_probe_02 spec Scenario "正缓存与地址编辑后失效"', async () => {
  let now = 0
  const { calls, probe } = scriptedProbe(host => host === 'a.test' || host === 'b.test')
  const selector = new LineSelector({ probe, now: () => now })
  const lines = [line('1', 'http://a.test:3425/v1'), line('2', 'http://b.test:3425/v1')]
  expect(await selector.select(lines)).toEqual(lines[0])
  expect(calls).toEqual(['a.test'])
  now = 3_000
  expect(await selector.select(lines)).toEqual(lines[0])
  expect(calls).toEqual(['a.test'])
  // Editing the preferred line's address invalidates its cached reachability:
  // the new address is probed on the next selection (c.test unreachable).
  lines[0] = line('1', 'http://c.test:3425/v1')
  expect(await selector.select(lines)).toEqual(lines[1])
  expect(calls).toEqual(['a.test', 'c.test', 'b.test'])
})

test('test_line_probe_03 spec Scenario "IPv6 字面量地址可被探测"', async () => {
  let listener: Awaited<ReturnType<typeof createTcpListener>>
  try { listener = await createTcpListener('::1') } catch { listener = undefined as never }
  if (!listener) return // environment without IPv6 loopback: scenario cannot run here
  cleanup.push(listener.close)
  const selector = new LineSelector()
  expect(await selector.select([line('1', `http://[::1]:${listener.port}/v1`)])).toBeDefined()
  // A single-line list never probes by design; exercise the IPv6 path with a
  // second, unreachable candidate so the selector has to probe the bracketed host.
  const { calls, probe } = scriptedProbe(host => host === '::1')
  const scripted = new LineSelector({ probe })
  expect(await scripted.select([line('1', `http://[::1]:${listener.port}/v1`), line('2', 'http://unreachable.test:1/v1')])).toEqual({ id: '1', baseUrl: `http://[::1]:${listener.port}/v1`, accessMode: 'direct' })
  expect(calls).toEqual(['::1'])
  // Real default probe must strip the brackets before net.connect.
  const real = await unreachableBaseUrl('::1')
  expect(await new LineSelector().select([line('1', real), line('2', `http://[::1]:${listener.port}/v1`)])).toEqual({ id: '2', baseUrl: `http://[::1]:${listener.port}/v1`, accessMode: 'direct' })
})

test('test_line_probe_04 spec Scenario "dispose 中止探测"', async () => {
  let calls = 0
  const probe: Probe = (_host, _port, _timeout, signal) => {
    calls++
    return new Promise(resolve => {
      if (signal?.aborted) { resolve(false); return }
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
  const selector = new LineSelector({ probe })
  const lines = [line('1', 'http://slow.test:3425/v1'), line('2', 'http://reachable.test:3425/v1')]
  const pending = selector.select(lines)
  selector.dispose()
  await expect(pending).resolves.toEqual(lines[0])
  expect(calls).toBe(1)
  // After dispose no new probe is started.
  expect(await selector.select(lines)).toEqual(lines[0])
  expect(calls).toBe(1)
})
