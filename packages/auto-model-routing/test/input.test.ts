import { expect, it } from 'vitest'
import { userInput } from '../src/input.js'

it('spec Scenario "首轮真实领取序列只取用户消息"', () => {
  const kinds = ['agent-instructions', 'plugin:dsh-memex', 'runtime-context', 'time-context', 'skill-catalog', 'user']
  expect(userInput(kinds.map(kind => ({ source: { kind }, content: [{ type: 'text', text: kind === 'user' ? '修复登录 bug' : kind }] })))).toEqual({ userTurn: true, text: '修复登录 bug' })
  expect(userInput([{ source: { kind: 'plugin' }, content: [{ type: 'text', text: 'ignore' }] }])).toEqual({ userTurn: false, text: '' })
})
it('spec Scenario "多条用户消息按序拼接并截断"', () => {
  expect(userInput([
    { source: { kind: 'user' }, content: [{ type: 'text', text: '先看日志' }] },
    { content: [{ type: 'text', text: 'excluded' }] },
    { source: { kind: 'user' }, content: [{ type: 'image' }, { type: 'text', text: '再改配置' }] },
  ]).text).toBe('先看日志\n再改配置')
  const text = 'a'.repeat(7999) + '😀'
  expect(userInput([{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]).text).toBe(text.slice(0, 8000))
  expect(userInput([{ source: { kind: 'user' }, content: [{ type: 'image' }] }])).toEqual({ userTurn: true, text: '' })
})
it('redacts_before_bounding', () => {
  // A key straddling the 8000 boundary must not leave its head behind after the cut.
  const text = 'a'.repeat(7990) + ' sk-' + 'Z'.repeat(30)
  const out = userInput([{ source: { kind: 'user' }, content: [{ type: 'text', text }] }]).text
  expect(out).toBe(('a'.repeat(7990) + ' <redacted>').slice(0, 8000))
  expect(out).not.toContain('sk-')
})
