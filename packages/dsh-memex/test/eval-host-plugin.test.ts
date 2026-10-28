import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ calls: [] as string[], judgeFails: false }))
vi.mock('../src/eval/managed-round.js', () => ({ createManagedRoundExecution: () => ({ run: async (input: any, signal: AbortSignal) => {
  f.calls.push('managed-round'); expect(input.controller).toBeDefined(); expect(input.routing).toBeTypeOf('function'); expect(input.backend.root).toBe('/stored'); expect(input.scopes).toBeDefined(); expect(signal.aborted).toBe(false); return { completed: true }
}, resume: async () => { f.calls.push('resume-round'); return {} } }) }))
vi.mock('../src/eval/offline-report.js', () => ({ buildOfflineReport: () => ({ exitCode: 0 }) }))
vi.mock('../src/eval/runtime-tracking.js', () => ({ startHostEvalTracking: () => { f.calls.push('track'); return { owners: new Set(), healthy: () => true, settleJobs: async () => { f.calls.push('settle') } } } }))
vi.mock('../src/eval/registered-judge.js', () => ({ createRegisteredRoundJudge: async () => {
  f.calls.push('parent')
  return { judge: async (_plan: unknown, item: { id: string }) => { f.calls.push(`judge:${item.id}`); if (f.judgeFails) throw new Error('child release unproven'); return ['scored'] }, dispose: async () => { f.calls.push('dispose') } }
} }))
import { createHostEvalDispatch } from '../src/eval/host-plugin.js'

const registration = { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }
function host(services: Record<string, unknown>) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "eval-host-plugin-"))
  const ctx = { get: (name: string) => services[name], effect: () => {} }
  const scopes = services.memexScopes as never
  return { root, dispatch: createHostEvalDispatch(ctx as never, root, { scopes, home: root, judgeCwd: join(root, 'judge'), timeoutMs: 1000, generation: "host-test" }) }
}
const full = { agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'default' }) }, memexScopes: { resolve: () => ({}) } }

it('assembles the production fixed runner exclusively from trusted Host services', async () => {
  f.calls.length = 0
  const { dispatch } = host({ ...full, sessionController: {}, autoModelRouting: { call: async () => ({ mode: 'MANUAL' }) }, sessionPersistence: { name: 'session-persistence-jsonl', config: { root: '/stored', compression: 'none' } }, agents: {}, jobs: {}, subagents: {}, workspaceRegistry: {}, agentPresets: {} })
  const signal = new AbortController().signal
  const round = await dispatch('eval/registerRound', registration, signal) as { id: string }
  expect(await dispatch('eval/runRound', { round: round.id, requestId: 'production' }, signal)).toEqual({ outcomes: { completed: true }, evidenceComplete: true })
  expect(f.calls).toEqual(['managed-round'])
})

it('missing execution services fail before subscribing or creating a judge parent', async () => {
  f.calls.length = 0
  const { dispatch } = host(full), signal = new AbortController().signal
  const round = await dispatch('eval/registerRound', registration, signal) as { id: string }
  await expect(dispatch('eval/runRound', { round: round.id, requestId: 'missing' }, signal)).rejects.toThrow(/service unavailable/)
  expect(f.calls).toEqual([])
})

it('creates tracking before the judge parent once per round, then scores through the managed judge', async () => {
  f.calls.length = 0; f.judgeFails = false
  const { dispatch } = host(full)
  const signal = new AbortController().signal
  const round = await dispatch('eval/registerRound', registration, signal) as { id: string }
  expect(await dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'a' }, signal)).toEqual(['scored'])
  expect(await dispatch('eval/judgeItem', { round: round.id, item: 'know-nomem', requestId: 'b' }, signal)).toEqual(['scored'])
  expect(f.calls).toEqual(['track', 'parent', 'judge:know-mem', 'judge:know-nomem'])
})

it('cancel settles tracked jobs and disposes the owned judge parent; a judge failure keeps the parent', async () => {
  f.calls.length = 0; f.judgeFails = false
  const ok = host(full), signal = new AbortController().signal
  const round = await ok.dispatch('eval/registerRound', registration, signal) as { id: string }
  await ok.dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'a' }, signal)
  expect(await ok.dispatch('eval/cancelRound', { round: round.id }, signal)).toEqual({ cancelled: true })
  expect(f.calls.slice(-2)).toEqual(['settle', 'dispose'])

  f.calls.length = 0; f.judgeFails = true
  const failing = host(full)
  const second = await failing.dispatch('eval/registerRound', registration, signal) as { id: string }
  await expect(failing.dispatch('eval/judgeItem', { round: second.id, item: 'know-mem', requestId: 'a' }, signal)).rejects.toThrow(/release unproven/)
  await expect(failing.dispatch('eval/cancelRound', { round: second.id }, signal)).rejects.toThrow(/release unproven/)
  expect(f.calls).not.toContain('dispose')
})

it('a missing Host service fails closed before any tracking, parent or model call', async () => {
  f.calls.length = 0; f.judgeFails = false
  const { dispatch } = host({ agentDefaultModel: full.agentDefaultModel })
  const signal = new AbortController().signal
  const round = await dispatch('eval/registerRound', registration, signal) as { id: string }
  await expect(dispatch('eval/judgeItem', { round: round.id, item: 'know-mem', requestId: 'a' }, signal)).rejects.toThrow(/scope/i)
  expect(f.calls).toEqual([])
})
