import { expect, it } from 'vitest'
import { confirmFixedSelftest } from '../src/eval/consent.js'
const request = { version: 'selftest-v1', tested: { provider: 'mock', model: 'tested' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 }
it('discloses fixed scope and side effects before exact explicit consent admits registration', async () => {
  const calls: string[] = []
  const result = await confirmFixedSelftest(request, async notice => {
    calls.push('confirm')
    for (const text of ['六条件', '12', '裁判父', '2 个追问回合', '真实文件', '事后', '默认模型', '不会自动恢复', '后代', '未知']) expect(notice).toContain(text)
    return 'RUN FIXED SELFTEST'
  }, async value => { calls.push('register'); expect(value).toEqual(request); return 'round' })
  expect(result).toBe('round')
  expect(calls).toEqual(['confirm', 'register'])
})
it('decline, approximate consent and unsupported suite never register anything', async () => {
  let calls = 0
  for (const answer of ['', 'yes', 'run fixed selftest']) {
    await expect(confirmFixedSelftest(request, async () => answer, async () => { calls++; return 'bad' })).rejects.toThrow(/declined/)
  }
  await expect(confirmFixedSelftest({ ...request, suite: 'business' }, async () => 'RUN FIXED SELFTEST', async () => { calls++; return 'bad' })).rejects.toThrow()
  expect(calls).toBe(0)
})
