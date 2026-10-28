import { expect, it } from 'vitest'
import { executeFixedItem, type TestedSessionPort } from '../src/eval/executor.js'

function harness() {
  const calls: string[] = []
  let title = '', mode = 'AUTO', route = { provider: 'p', model: 'old' }
  const port: TestedSessionPort = {
    create: async id => { calls.push(`create:${id}`) },
    rename: async (_id, value) => { calls.push('rename'); title = value },
    setManual: async () => { calls.push('manual'); mode = 'MANUAL' },
    selectModel: async (_id, value) => { calls.push('select'); route = value },
    inspect: async () => ({ title, userPinned: true, mode, route }),
    prompt: async (_id, text) => { calls.push(`prompt:${text}`) },
  }
  return { port, calls }
}
const input = { sessionId: 'reserved-session', title: 'Memex selftest round/know/mem/attempt', route: { provider: 'p', model: 'fixed' }, prompt: 'fictional prompt', followUp: 'natural followup' }

it('EVAL-014: 顶层默认 AUTO 被显式关闭', async () => {
  const h = harness()
  await executeFixedItem(h.port, input)
  expect(h.calls).toEqual(['create:reserved-session', 'rename', 'manual', 'select', 'prompt:fictional prompt', 'prompt:natural followup'])
})

it('EVAL-018: 固定标题失败不发题', async () => {
  const h = harness(); h.port.rename = async () => { throw new Error('rename failed') }
  await expect(executeFixedItem(h.port, input)).rejects.toThrow('rename failed')
  expect(h.calls.some(call => call.startsWith('prompt:'))).toBe(false)
})

it('rechecks MANUAL and model before a natural follow-up after the initial turn', async () => {
  const h = harness()
  let sent = 0
  h.port.prompt = async () => { sent++ }
  const inspect = h.port.inspect
  h.port.inspect = async id => ({ ...await inspect(id), ...(sent ? { mode: 'AUTO' } : {}) })
  await expect(executeFixedItem(h.port, input)).rejects.toThrow(/readback/)
  expect(sent).toBe(1)
})

it('refuses incorrect title pin, mode or model readback before sending a question', async () => {
  for (const mismatch of [{ userPinned: false }, { mode: 'AUTO' }, { route: { provider: 'p', model: 'wrong' } }, { route: { ...input.route, effort: 'high' } }]) {
    const h = harness()
    const inspect = h.port.inspect
    h.port.inspect = async id => ({ ...await inspect(id), ...mismatch })
    await expect(executeFixedItem(h.port, input)).rejects.toThrow(/readback/)
    expect(h.calls.some(call => call.startsWith('prompt:'))).toBe(false)
  }
})
