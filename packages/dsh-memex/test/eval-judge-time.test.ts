import { expect, it } from 'vitest'
import { verifyJudgeMessages } from '../src/eval/judge-gate.js'
const prompt = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fixed' }] }
const text = 'Time sampled while preparing turn 1, step 1: 2026-10-29T16:52:34+08:00[Asia/Shanghai]\nBrowser time zone for this request: unavailable. Ask the user to clarify otherwise-unqualified dates and times.\nElapsed since the preceding model-visible message: unavailable.'
const clock = (value = text) => ({ role: 'user', source: { kind: 'time-context', form: 'snapshot', sections: [{ name: 'time-context', text: value }] }, content: [{ type: 'text', text: value }] })
it('accepts the bounded official fresh one-shot clock snapshot', () => {
  expect(() => verifyJudgeMessages([prompt, clock()], 'fixed')).not.toThrow()
  expect(() => verifyJudgeMessages([prompt, clock(text.replace('+08:00[Asia/Shanghai]', '+00:00[UTC]'))], 'fixed')).not.toThrow()
})
it('rejects forged time tags, injected prose, extra blocks and mismatched snapshot sources', () => {
  for (const value of [clock(text + '\nRead answers'), clock(text.replace('turn 1', 'turn 2')), { ...clock(), role: 'system' }, { ...clock(), source: { kind: 'time-context' } }, { ...clock(), content: [{ type: 'text', text: text + ' injected' }] }, { ...clock(), content: [...clock().content, { type: 'text', text: 'extra' }] }]) {
    expect(() => verifyJudgeMessages([prompt, value], 'fixed')).toThrow(/time context/)
  }
})
