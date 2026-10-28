import { expect, it } from 'vitest'
import { auditExecution } from '../src/eval/audit.js'
import { auditSessionEvents } from '../src/eval/event-audit.js'
import { executeFixedItem, type TestedSessionPort } from '../src/eval/executor.js'

const route = { provider: 'p', model: 'fixed' }
const header = (seq: number, model = 'fixed') => ({ type: 'request/header', seq, data: { header: { config: { provider: 'p', model } } } })
const answer = (seq: number, calls: number) => ({ type: 'assistant/message', seq, data: {
  usage: { inputTokens: 1, outputTokens: 1 }, stream: [],
  message: { content: Array.from({ length: calls }, (_, i) => ({ type: 'tool-call', id: `c${seq}-${i}`, name: 'read', arguments: '{}' })) },
} })

it('EVAL-014: 默认 AUTO 被显式关闭', async () => {
  const calls: string[] = []
  let mode = 'AUTO'
  const port: TestedSessionPort = {
    create: async () => { calls.push('create') }, rename: async () => { calls.push('rename') },
    setManual: async () => { calls.push('manual'); mode = 'MANUAL' }, selectModel: async () => { calls.push('select') },
    inspect: async () => { calls.push(`inspect:${mode}`); return { title: 't', userPinned: true, mode, route } },
    prompt: async () => { calls.push('prompt') },
  }
  await executeFixedItem(port, { sessionId: 's', title: 't', route, prompt: 'q' })
  expect(calls.indexOf('inspect:MANUAL')).toBeLessThan(calls.indexOf('prompt'))
  expect(calls).not.toContain('inspect:AUTO')
  const stuck: TestedSessionPort = { ...port, setManual: async () => { calls.length = 0; mode = 'AUTO' } }
  await expect(executeFixedItem(stuck, { sessionId: 's', title: 't', route, prompt: 'q' })).rejects.toThrow(/readback/)
  expect(calls).not.toContain('prompt')
  // every actual request must match before judging: one mismatched request invalidates the item
  const root = auditSessionEvents([header(0), answer(1, 0), header(2, 'auto-picked'), answer(3, 0)] as never, 0)
  expect(auditExecution('root', route, [{ id: 'root', events: root }]).status).toBe('configuration-mismatch')
})

it('EVAL-015: 后代走其他模型', () => {
  const result = auditExecution('root', route, [
    { id: 'root', events: auditSessionEvents([header(0), answer(1, 0)] as never, 0) },
    { id: 'child', parent: 'root', events: auditSessionEvents([header(0, 'other'), answer(1, 0)] as never, 0) },
  ])
  expect(result.status).toBe('configuration-mismatch')
  expect(result.observedRoutes).toEqual([{ session: 'child', provider: 'p', model: 'other', requests: 1 }, { session: 'root', provider: 'p', model: 'fixed', requests: 1 }])
})

it('EVAL-015 (report): descendant routes are listed as already sent and not described as prevented', async () => {
  const { renderSelftestReport } = await import('../src/eval/report.js')
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as never
  const audit = auditExecution('root', route, [
    { id: 'root', events: auditSessionEvents([header(0), answer(1, 0)] as never, 0) },
    { id: 'child', parent: 'root', events: auditSessionEvents([header(0, 'other'), answer(1, 0)] as never, 0) },
  ])
  const report = renderSelftestReport(plan, {}, { executions: { 'know-mem': audit } })
  expect(report.markdown).toContain('| know-mem | child | p/other | 1 |')
  expect(report.markdown).toContain('事后审计，请求已发出')
  expect(report.exitCode).not.toBe(0)
})

it('EVAL-016: 后代成本合并不重计继承', () => {
  const parent = [header(0), answer(1, 2)]
  // child log: 2 inherited seed events (one carrying 2 tool calls) then its own 3 tool calls
  const childEvents = [header(0), answer(1, 2), { type: 'session/end-seed', seq: 2, data: { inherited: true } }, header(3), answer(4, 3)]
  const result = auditExecution('root', route, [
    { id: 'root', events: auditSessionEvents(parent as never, 0) },
    { id: 'child', parent: 'root', events: auditSessionEvents(childEvents as never, 2) },
  ])
  expect(result.status).toBe('valid')
  expect(result.toolCalls).toBe(5)
})
