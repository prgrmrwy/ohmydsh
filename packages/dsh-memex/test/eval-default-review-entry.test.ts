import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createEvalBridge } from '../src/eval/host.js'
import { runSelftestCli } from '../src/cli/eval-selftest.js'
it('requires explicit manual confirmation and only then allows the next fixed round; no default write capability exists', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-default-entry-'))
  const bridge = createEvalBridge({ root, currentDefault: () => ({ provider: 'p', model: 'm' }), judge: async () => ({}), cancel: async () => {} })
  const signal = new AbortController().signal
  const registration = { version: 'selftest-v1', tested: { provider: 'p', model: 'm' }, judge: { provider: 'p', model: 'm' }, maxJudgeCalls: 12 }
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  expect(await bridge.dispatch('eval/pendingDefaultReviews', {}, signal)).toEqual([{ round: round.id, notice: expect.stringContaining('运行前默认值') }])
  await expect(bridge.dispatch('eval/confirmDefaultReview', { round: round.id }, signal)).rejects.toThrow(/Explicit/)
  await expect(bridge.dispatch('eval/registerRound', registration, signal)).rejects.toThrow(/Pending/)
  await bridge.dispatch('eval/confirmDefaultReview', { round: round.id, confirmation: 'I REVIEWED THE DEFAULT MODEL' }, signal)
  expect(await bridge.dispatch('eval/pendingDefaultReviews', {}, signal)).toEqual([])
  expect(await bridge.dispatch('eval/registerRound', registration, signal)).toMatchObject({ id: expect.any(String) })
})
it('resume uses only the frozen round and explicit confirmation, never accepts new routes', async () => {
  const calls: string[] = []
  const io = { out() {}, error() {}, confirm: async () => 'RESUME FIXED SELFTEST', call: async (endpoint: string) => { calls.push(endpoint); return { evidenceComplete: true } } }
  expect(await runSelftestCli(['--resume', 'round-00000000-0000-0000-0000-000000000000'], io)).toBe(0)
  expect(calls).toEqual(['eval/status', 'eval/resumeRound'])
  calls.length = 0
  expect(await runSelftestCli(['--resume', 'round-00000000-0000-0000-0000-000000000000', '--tested', 'foreign/model'], io)).toBe(2)
  expect(calls).toEqual([])
})
it('all-unknown run completion is nonzero and preserves the default warning; status never runs models', async () => {
  let text = ''
  const calls: string[] = []
  const io = { out: (value: string) => { text += value }, error: (value: string) => { text += value }, confirm: async () => 'RUN FIXED SELFTEST', call: async (endpoint: string) => {
    calls.push(endpoint)
    if (endpoint === 'eval/pendingDefaultReviews') return []
    if (endpoint === 'eval/registerRound') return { id: 'round-00000000-0000-0000-0000-000000000000', items: Array(6) }
    if (endpoint === 'eval/runRound') return { evidenceComplete: false }
    return { defaultModelNotice: 'manual review required' }
  } }
  expect(await runSelftestCli(['--tested', 'p/m', '--judge', 'p/m'], io)).toBe(1)
  expect(text).toContain('manual review required')
  calls.length = 0
  expect(await runSelftestCli(['--status', 'round-00000000-0000-0000-0000-000000000000'], io)).toBe(0)
  expect(calls).toEqual(['eval/status'])
})
