import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createEvalBridge } from '../src/eval/host.js'
it('explicit resume delegates release proof to the continuous Host owner without retrying the failed whole-round request', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-resume-bridge-')), signal = new AbortController().signal
  let runs = 0, resumes = 0
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {}, run: async () => { runs++; throw Error('ordinary collection failed, owned scene retained') }, resume: async () => { resumes++; return { evidenceComplete: true } } })
  const plan = await bridge.dispatch('eval/registerRound', { version: 'selftest-v1', tested: { provider: 'p', model: 't' }, judge: { provider: 'p', model: 'j' }, maxJudgeCalls: 12 }, signal) as { id: string }
  await expect(bridge.dispatch('eval/runRound', { round: plan.id, requestId: 'initial' }, signal)).rejects.toThrow(/collection/)
  await expect(bridge.dispatch('eval/runRound', { round: plan.id, requestId: 'retry' }, signal)).rejects.toThrow(/unhealthy/)
  expect(await bridge.dispatch('eval/resumeRound', { round: plan.id, requestId: 'explicit' }, signal)).toEqual({ evidenceComplete: true })
  expect(await bridge.dispatch('eval/resumeRound', { round: plan.id, requestId: 'explicit' }, signal)).toEqual({ evidenceComplete: true })
  expect(runs).toBe(1); expect(resumes).toBe(1)
  const reconstructed = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {}, run: async () => {} })
  await expect(reconstructed.dispatch('eval/resumeRound', { round: plan.id, requestId: 'foreign' }, signal)).rejects.toThrow(/same-Host/)
})
