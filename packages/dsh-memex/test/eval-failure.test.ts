import { mkdtempSync, realpathSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createEvalBridge } from '../src/eval/host.js'
import { EvalPhaseFailure, safeEvalFailure, checkedEvalFailure } from '../src/eval/failure.js'

it('persists safe per-request failure diagnostics and status without authorizing a retry', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-failure-'))
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {},
    run: async () => { throw new EvalPhaseFailure('retire', new Error('Test owner inbox not empty after retirement')) } })
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', { version: 'selftest-v1', tested: { provider: 'p', model: 'm' }, judge: { provider: 'p', model: 'm' }, maxJudgeCalls: 12 }, signal) as { id: string }
  await expect(bridge.dispatch('eval/runRound', { round: round.id, requestId: 'failed' }, signal)).rejects.toThrow()
  const status = await bridge.dispatch('eval/status', { round: round.id }, signal) as any
  expect(status.failures).toEqual([{ requestId: 'failed', diagnostic: expect.objectContaining({ phase: 'retire', causes: [expect.objectContaining({ code: 'root-inbox-pending' })] }) }])
  expect(JSON.parse(readFileSync(join(root, round.id, 'failure-failed.json'), 'utf8'))).toEqual(status.failures[0].diagnostic)
  expect(existsSync(join(root, round.id, 'result-failed.json'))).toBe(false)
  await expect(bridge.dispatch('eval/runRound', { round: round.id, requestId: 'another' }, signal)).rejects.toThrow(/unhealthy/)
  writeFileSync(join(root, round.id, 'failure-failed.json'), JSON.stringify({ ...status.failures[0].diagnostic, raw: 'secret-token' }))
  await expect(bridge.dispatch('eval/status', { round: round.id }, signal)).rejects.toThrow(/Invalid eval failure diagnostic/)
})

it('marks the round unhealthy even when diagnostic persistence fails', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-failure-'))
  let runs = 0
  const bridge = createEvalBridge({ root, currentDefault: () => ({}), judge: async () => ({}), cancel: async () => {}, run: async () => { runs++; throw Error('failed') } })
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', { version: 'selftest-v1', tested: { provider: 'p', model: 'm' }, judge: { provider: 'p', model: 'm' }, maxJudgeCalls: 12 }, signal) as { id: string }
  writeFileSync(join(root, round.id, 'failure-failed.json'), 'preexisting')
  await expect(bridge.dispatch('eval/runRound', { round: round.id, requestId: 'failed' }, signal)).rejects.toThrow(/persistence unavailable/)
  expect(existsSync(join(root, round.id, 'unhealthy'))).toBe(true)
  await expect(bridge.dispatch('eval/runRound', { round: round.id, requestId: 'another' }, signal)).rejects.toThrow(/unhealthy/)
  expect(runs).toBe(1)
})

it('identifies the actual production pre-resume guard without requiring a model request', () => {
  const error = new Error('Continuous same-Host execution unavailable; resume refused')
  error.stack = `Error: ${error.message}\n at execute (/private/eval/host-plugin.js:79:25)`
  const diagnostic = safeEvalFailure(error)
  expect(diagnostic.code).toBe('resume-owner-missing')
  expect(diagnostic.frames).toEqual([{ file: 'host-plugin', line: 79 }])
  expect(checkedEvalFailure(diagnostic)).toEqual(diagnostic)
})

it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('treats inherited object key %s as an unknown reason', message => {
  const diagnostic = safeEvalFailure(new Error(message))
  expect(diagnostic.code).toBe('unexpected-host-error')
  expect(checkedEvalFailure(JSON.parse(JSON.stringify(diagnostic)))).toEqual(diagnostic)
})

it('drops exception text, secret values, arbitrary stack paths and codes, including aggregate causes', () => {
  const error = Object.assign(new Error('secret-token https://private/?token=secret-token\n at fake (/safe/eval/host.js:123:1)'), { code: 'secret-token' })
  error.stack = `Error: ${error.message}\n at f (/private/secret-token.ts:9:1)\n at f (/safe/eval/host-reader.js:24:3)`
  const result = safeEvalFailure(new AggregateError([new EvalPhaseFailure('collect', error)], 'secret-token'))
  expect(JSON.stringify(result)).not.toMatch(/secret-token|https:|private/)
  expect(result.causes[0]?.causes[0]?.frames).toEqual([{ file: 'host-reader', line: 24 }])
  expect(checkedEvalFailure(result)).toEqual(result)
  expect(() => checkedEvalFailure({ ...result, code: 'secret-token' })).toThrow(/Invalid/)
  expect(() => checkedEvalFailure({ ...result, frames: [{ file: 'host-reader', line: 2, token: 'secret-token' }] })).toThrow(/Invalid/)
})
