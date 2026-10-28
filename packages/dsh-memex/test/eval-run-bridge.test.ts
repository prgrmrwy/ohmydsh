import { mkdtempSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { createEvalBridge } from '../src/eval/host.js'
const registration = { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }
it('runs only the frozen six-condition plan once, and returns a durable result for the same request', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-run-bridge-'))
  let calls = 0
  const options = { root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {},
    run: async (round: { items: unknown[] }, signal: AbortSignal) => { calls++; expect(signal.aborted).toBe(false); expect(round.items).toHaveLength(6); return { completed: true } } }
  const bridge = createEvalBridge(options), signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  const request = { round: round.id, requestId: 'run-once' }
  await expect(bridge.dispatch('eval/runRound', { ...request, evidencePath: '/private' }, signal)).rejects.toThrow()
  const result = await bridge.dispatch('eval/runRound', request, signal)
  expect(result).toEqual({ completed: true })
  expect(await createEvalBridge(options).dispatch('eval/runRound', request, signal)).toEqual(result)
  expect(calls).toBe(1)
  await expect(bridge.dispatch('eval/runRound', { ...request, requestId: 'new-id' }, signal)).rejects.toThrow(/already|identity/)
})
it('creates a private first-run output root and rejects symlink ancestors before registering any plan', async () => {
  const { mkdirSync, symlinkSync, statSync } = await import('node:fs')
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'eval-first-root-'))
  const root = join(parent, 'private', 'selftest')
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {} })
  const plan = await bridge.dispatch('eval/registerRound', registration, new AbortController().signal) as { id: string }
  expect(plan.id).toMatch(/^round-/)
  expect(statSync(root).mode & 0o777).toBe(0o700)
  const target = join(parent, 'target'); mkdirSync(target)
  symlinkSync(target, join(parent, 'linked'))
  const unsafe = createEvalBridge({ root: join(parent, 'linked', 'selftest'), currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {} })
  await expect(unsafe.dispatch('eval/registerRound', registration, new AbortController().signal)).rejects.toThrow(/symbolic|Unsafe/)
})

it('Host unload aborts active round work and closes admission before waiting for settlement', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-unload-'))
  let entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {},
    run: async (_round, signal) => { entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); throw new Error('unloaded') } })
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  const work = bridge.dispatch('eval/runRound', { round: round.id, requestId: 'unload' }, signal).catch(error => error)
  await ready
  await bridge.dispose()
  expect(await work).toMatchObject({ message: 'unloaded' })
  await expect(bridge.dispatch('eval/readDefaultModel', {}, signal)).rejects.toThrow(/closed/)
})

it('disconnect aborts the Host-owned round and a reconstructed bridge refuses uncertain replay', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-run-lost-'))
  let entered!: () => void
  const ready = new Promise<void>(resolve => { entered = resolve })
  const options = { root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {},
    run: async (_round: unknown, signal: AbortSignal) => { entered(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); throw new Error('round disconnected') } }
  const bridge = createEvalBridge(options), carrier = new AbortController()
  const round = await bridge.dispatch('eval/registerRound', registration, carrier.signal) as { id: string }
  const request = { round: round.id, requestId: 'lost' }
  const work = bridge.dispatch('eval/runRound', request, carrier.signal).catch(error => error)
  await ready; carrier.abort()
  expect(await work).toMatchObject({ message: 'round disconnected' })
  expect(await createEvalBridge(options).dispatch('eval/status', { round: round.id }, new AbortController().signal)).toMatchObject({ unhealthy: true })
  await expect(createEvalBridge(options).dispatch('eval/runRound', request, new AbortController().signal)).rejects.toThrow(/unhealthy|uncertain/)
})
