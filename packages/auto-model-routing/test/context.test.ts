import { expect, it } from 'vitest'
import { buildState, previousTurn, redact } from '../src/context.js'

const user = (text: string, kind = 'user') => ({ role: 'user', source: { kind }, content: [{ type: 'text', text }] })
const assistant = (text: string) => ({ role: 'assistant', content: [{ type: 'text', text }] })

it('spec Scenario "脱敏覆盖常见形态且不误伤正文"', () => {
  const key = `sk-${'A1b2C3d4E5'.repeat(4)}`.slice(0, 40)
  const head = [
    '{"API_KEY": "abc123"}',
    'Token：xyz789',
    'Authorization: Bearer abcdefgh12345',
    'ghp_0123456789abcdefghijABCD',
    'https://u:p@host/x',
    'token 过期了怎么办',
  ].join('\n')
  // The key starts 10 characters before the last-1200 boundary: truncating first would leave its tail.
  const tail = 'x'.repeat(1200 - 30)
  const text = `${head}\n${key}${tail}`
  expect(text.length - text.indexOf(key)).toBe(1200 + 10)
  const out = redact(text).slice(-1200)
  const whole = redact(text)
  for (const secret of ['abc123', 'xyz789', 'abcdefgh12345', 'ghp_0123', 'u:p@']) expect(whole).not.toContain(secret)
  for (let i = 0; i + 8 <= key.length; i++) expect(out).not.toContain(key.slice(i, i + 8))
  expect(whole).toContain('token 过期了怎么办')
  expect(whole).toContain('"API_KEY": "<redacted>')
  expect(whole).toContain('Token：<redacted>')
  expect(whole).toContain('Bearer <redacted>')
  expect(whole).toContain('//<redacted>@host')
  expect(redact('-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----')).toBe('<redacted>')
  expect(redact('AKIAABCDEFGHIJKLMNOP')).toBe('<redacted>')
  expect(redact('at 10.1.2.3:8080 ok')).toBe('at <ip> ok')
})

it('spec Scenario "上一轮上下文截断、取末段并脱敏"', () => {
  const longUser = '问'.repeat(900)
  const reply = `${'答'.repeat(3000 - 40)} token=abc123def456 at 10.1.2.3:8080`
  const messages = [
    user('更早的问题'),
    assistant('更早的回答'),
    user('Host 指令', 'agent-instructions'),
    user(longUser),
    assistant('早先内容'),
    { role: 'assistant', content: [{ type: 'tool-call', id: 't' }] },
    assistant(reply),
    { role: 'tool', content: [{ type: 'text', text: 'tool output' }] },
  ]
  const previous = previousTurn(messages)
  expect(previous).toEqual({ user: longUser, assistant: reply })
  const state = buildState({ prevUser: previous.user, prevAssistant: previous.assistant, text: '继续' })
  const lines = state.split('\n')
  expect(lines[0]).toBe('Previous user-turn tier: none')
  expect(state).toContain(`Previous user message (truncated):\n${'问'.repeat(500)}\n`)
  expect(state).not.toContain('问'.repeat(501))
  const redactedReply = redact(reply)
  expect(state).toContain(`Previous assistant reply (last part):\n${redactedReply.slice(-1200)}\n`)
  expect(state).not.toContain('早先内容')
  expect(state).not.toContain('abc123def456')
  expect(state).not.toContain('10.1.2.3')
  expect(state).toContain('token=<redacted>')
  expect(state).toContain('<ip>')
  expect(state.endsWith('New user message:\n继续')).toBe(true)
})

it('first_turn_state_has_no_context', () => {
  expect(previousTurn([user('Host 指令', 'agent-instructions')])).toEqual({})
  expect(buildState({ text: '看下这个报错' })).toBe('Previous user-turn tier: none\nUser message:\n看下这个报错')
  // Only one side present: the explanation line stays, the missing section is omitted.
  const onlyUser = buildState({ prevUser: '修一下登录', text: '继续' })
  expect(onlyUser.split('\n')[0]).toBe('Previous user-turn tier: none')
  expect(onlyUser).toContain('Previous user message (truncated):\n修一下登录')
  expect(onlyUser).not.toContain('Previous assistant reply')
})
