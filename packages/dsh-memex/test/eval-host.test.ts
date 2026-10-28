import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createEvalBridge } from '../src/eval/host.js'
import { runBoundedJudge } from '../src/eval/judge-lifetime.js'
import { loadOfflineOutcomes } from '../src/eval/offline-outcomes.js'

function harness() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-'))
  const calls: string[] = []
  const bridge = createEvalBridge({ root, currentDefault: () => ({ provider: 'p', model: 'before' }),
    judge: async (round, item, signal) => { calls.push(item.id); if (signal.aborted) throw new Error('aborted'); return { status: 'unknown', reason: round.id } },
    cancel: async id => { calls.push(`cancel:${id}`) },
  })
  return { bridge, calls }
}
const registration = { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }

it('EVAL-031: 伪造路线或任意证据被拒绝', async () => {
  const { bridge, calls } = harness()
  const round = await bridge.dispatch('eval/registerRound', registration, new AbortController().signal) as { id: string }
  for (const extra of [{ provider: 'other' }, { evidencePath: '/tmp/a' }, { schema: {} }]) {
    await expect(bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'r1', ...extra }, new AbortController().signal)).rejects.toThrow()
  }
  expect(calls).toEqual([])
})

it('binds stable requests to frozen items and returns saved results without another judge call', async () => {
  const { bridge, calls } = harness()
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  const input = { round: round.id, item: 'know-mem', requestId: 'request-1' }
  const results = await Promise.all([bridge.dispatch('eval/judgeItem', input, signal), bridge.dispatch('eval/judgeItem', input, signal)])
  expect(results[0]).toEqual(results[1])
  expect(await bridge.dispatch('eval/judgeItem', input, signal)).toEqual(results[0])
  expect(calls).toEqual(['know-mem'])
  await expect(bridge.dispatch('eval/judgeItem', { ...input, item: 'stale-mem' }, signal)).rejects.toThrow(/identity/)
})

it('does not bypass a frozen item attempt by minting a different request ID', async () => {
  const { bridge, calls } = harness()
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  await bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'first' }, signal)
  await expect(bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'retry' }, signal)).rejects.toThrow(/already/)
  expect(calls).toEqual(['know-mem'])
})

it('cancelled rounds never admit another judge request', async () => {
  const { bridge, calls } = harness()
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  await bridge.dispatch('eval/cancelRound', { round: round.id }, signal)
  await expect(bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'after-cancel' }, signal)).rejects.toThrow(/cancel/)
  expect(calls).toEqual([`cancel:${round.id}`])
})

it('cancel aborts active Host-owned work before awaiting resource retirement', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-active-'))
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  let ownedSignal: AbortSignal | undefined
  const carrier = new AbortController()
  const bridge = createEvalBridge({ root, currentDefault: () => ({}),
    judge: async (_round, _item, signal) => { ownedSignal = signal; entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); throw new Error('aborted judge') },
    cancel: async () => { expect(ownedSignal?.aborted).toBe(true) },
  })
  const round = await bridge.dispatch('eval/registerRound', registration, carrier.signal) as { id: string }
  const work = bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'active' }, carrier.signal)
  const observed = work.catch(error => error)
  await started
  expect(ownedSignal).not.toBe(carrier.signal)
  await expect(bridge.dispatch('eval/cancelRound', { round: round.id }, carrier.signal)).rejects.toThrow(/release unproven/)
  expect(await observed).toMatchObject({ message: 'aborted judge' })
  expect(carrier.signal.aborted).toBe(false)
})

it('carrier disconnect aborts owned work without replaying its uncertain request', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-disconnect-'))
  const carrier = new AbortController()
  let calls = 0, entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), cancel: async () => {}, judge: async (_round, _item, signal) => {
    calls++; entered()
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    throw new Error('disconnected')
  } })
  const round = await bridge.dispatch('eval/registerRound', registration, carrier.signal) as { id: string }
  const input = { round: round.id, item: 'know-mem', requestId: 'lost' }
  const work = bridge.dispatch('eval/judgeItem', input, carrier.signal).catch(error => error)
  await ready; carrier.abort()
  expect(await work).toMatchObject({ message: 'disconnected' })
  await expect(bridge.dispatch('eval/judgeItem', input, new AbortController().signal)).rejects.toThrow(/uncertain/)
  expect(calls).toBe(1)
})

it('EVAL-034: 裁判超时或客户端断开', async () => {
  for (const cause of ['timeout', 'disconnect'] as const) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), `eval-bridge-${cause}-`))
    const carrier = new AbortController()
    let disposed = false, scored = 0
    const bridge = createEvalBridge({ root, currentDefault: () => ({}), cancel: async () => {},
      judge: (_round, _item, signal) => { scored++; return runBoundedJudge(signal, cause === 'timeout' ? 20 : 60_000, async owned => ({
        result: new Promise((_, reject) => owned.addEventListener('abort', () => reject(new Error(`judge ${cause}`)), { once: true })),
        dispose: async () => { disposed = true },
      })) },
    })
    const round = await bridge.dispatch('eval/registerRound', registration, new AbortController().signal) as { id: string }
    const work = bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'r1' }, carrier.signal).catch(error => error)
    if (cause === 'disconnect') { await new Promise(resolve => setTimeout(resolve, 5)); carrier.abort() }
    expect(String(await work)).toMatch(/abort|timeout|disconnect/)
    expect(disposed).toBe(true)
    // the aborted item has no result, so offline outcomes keep it unknown
    expect(loadOfflineOutcomes(root, round.id)['know-mem']?.endpoint).toEqual(['unknown', 'unknown'])
    // no further item is scored after the uncertain abort
    await expect(bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-nomem', requestId: 'r2' }, new AbortController().signal)).rejects.toThrow(/unhealthy/)
    expect(scored).toBe(1)
  }
})

it('a failed judge makes the round persistently unhealthy across bridge reconstruction', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-sticky-'))
  let calls = 0, cancellations = 0
  const options = { root, currentDefault: () => ({}), judge: async () => { calls++; throw new Error('uncertain child release') }, cancel: async () => { cancellations++ } }
  const first = createEvalBridge(options), signal = new AbortController().signal
  const round = await first.dispatch('eval/registerRound', registration, signal) as { id: string }
  await expect(first.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'failed' }, signal)).rejects.toThrow('uncertain child release')
  const rebuilt = createEvalBridge(options)
  expect(await rebuilt.dispatch('eval/status', { round: round.id }, signal)).toMatchObject({ unhealthy: true })
  await expect(rebuilt.dispatch('eval/judgeItem', { round: round.id, item: 'know-nomem', requestId: 'next' }, signal)).rejects.toThrow(/unhealthy/)
  await expect(rebuilt.dispatch('eval/cancelRound', { round: round.id }, signal)).rejects.toThrow(/release unproven/)
  expect(calls).toBe(1)
  expect(cancellations).toBe(1)
})

it('hard-interrupted started requests block the whole round after reconstruction without a failure marker', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-crashed-'))
  let calls = 0
  const options = { root, currentDefault: () => ({}), judge: async () => { calls++; return {} }, cancel: async () => {} }
  const signal = new AbortController().signal
  const round = await createEvalBridge(options).dispatch('eval/registerRound', registration, signal) as { id: string }
  writeFileSync(join(root, round.id, 'request-lost-result.json'), JSON.stringify({ item: 'know-mem', requestId: 'lost-result' }))
  const rebuilt = createEvalBridge(options)
  expect(await rebuilt.dispatch('eval/status', { round: round.id }, signal)).toMatchObject({ unhealthy: true, uncertainRequests: ['lost-result'] })
  await expect(rebuilt.dispatch('eval/judgeItem', { round: round.id, item: 'know-nomem', requestId: 'next' }, signal)).rejects.toThrow(/uncertain/)
  expect(calls).toBe(0)
})

it('unrecognized legacy judge artifacts refuse automatic recovery', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-bridge-legacy-'))
  const options = { root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {} }
  const signal = new AbortController().signal
  const round = await createEvalBridge(options).dispatch('eval/registerRound', registration, signal) as { id: string }
  writeFileSync(join(root, round.id, 'judge-old.json'), '{}')
  await expect(createEvalBridge(options).dispatch('eval/status', { round: round.id }, signal)).rejects.toThrow(/manual inspection/)
})

it('request IDs with result suffixes cannot collide with another request result', async () => {
  const { bridge, calls } = harness(), signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  await bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'same' }, signal)
  await bridge.dispatch('eval/judgeItem', { round: round.id, item: 'know-nomem', requestId: 'same-result' }, signal)
  expect(calls).toEqual(['know-mem', 'know-nomem'])
})

it('unknown rounds/items, restore endpoints and disconnected requests never start work', async () => {
  const { bridge, calls } = harness()
  const controller = new AbortController(); controller.abort()
  await expect(bridge.dispatch('eval/registerRound', registration, controller.signal)).rejects.toThrow(/abort/)
  await expect(bridge.dispatch('eval/restoreDefaultModel', {}, new AbortController().signal)).rejects.toThrow()
  await expect(bridge.dispatch('eval/judgeItem', { round: 'missing', item: 'know-mem', requestId: 'r' }, new AbortController().signal)).rejects.toThrow()
  expect(calls).toEqual([])
})
