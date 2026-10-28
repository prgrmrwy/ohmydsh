import { mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DefaultModelNotice } from '../src/eval/default-model.js'
import { createEvalBridge } from '../src/eval/host.js'
const registration = { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }

it('EVAL-019: 检测后只提示不写回', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'eval-default-'))
  const notice = new DefaultModelNotice(dir)
  notice.begin({ provider: 'p', model: 'A' })
  expect(notice.describe({ provider: 'p', model: 'B' })).toMatch(/A[\s\S]*B[\s\S]*手动/)
  expect(notice.pending()).toBe(true)
})

it('EVAL-019 (bridge level): detection reports A and B, the Host value stays B and no write endpoint exists', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-default-bridge-'))
  let current: unknown = { provider: 'p', model: 'A' }
  const writes: unknown[] = []
  const bridge = createEvalBridge({ root, currentDefault: () => current, judge: async () => ({}), cancel: async () => {} })
  const signal = new AbortController().signal
  const round = await bridge.dispatch('eval/registerRound', registration, signal) as { id: string }
  current = { provider: 'p', model: 'B' }
  const status = await bridge.dispatch('eval/status', { round: round.id }, signal) as { defaultModelNotice: string }
  expect(status.defaultModelNotice).toMatch(/"A"[\s\S]*"B"[\s\S]*手动/)
  for (const endpoint of ['eval/restoreDefaultModel', 'eval/setDefaultModel', 'eval/writeDefaultModel']) {
    await expect(bridge.dispatch(endpoint, { selection: { provider: 'p', model: 'A' } }, signal)).rejects.toThrow()
  }
  expect(current).toEqual({ provider: 'p', model: 'B' })
  expect(writes).toEqual([])
})

it('EVAL-020: 硬中断下次提醒', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'eval-default-'))
  new DefaultModelNotice(dir).begin({ provider: 'p', model: 'A' })
  const afterRestart = new DefaultModelNotice(dir)
  expect(afterRestart.describe({ provider: 'p', model: 'A' })).toContain('手动')
  expect(afterRestart.pending()).toBe(true)
  afterRestart.confirm()
  expect(afterRestart.pending()).toBe(false)
})

it('EVAL-020 (bridge level): a pending notice from a killed round blocks the next registration before any round or session', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-default-restart-'))
  const options = { root, currentDefault: () => ({ provider: 'p', model: 'A' }), judge: async () => ({}), cancel: async () => {} }
  const signal = new AbortController().signal
  const killed = await createEvalBridge(options).dispatch('eval/registerRound', registration, signal) as { id: string }
  const restarted = createEvalBridge(options)
  await expect(restarted.dispatch('eval/registerRound', registration, signal)).rejects.toThrow(new RegExp(`${killed.id}[\\s\\S]*手动`))
  expect(readdirSync(root).filter(name => name.startsWith('round-'))).toEqual([killed.id])
  expect(new DefaultModelNotice(join(root, killed.id)).pending()).toBe(true)
})
