import { expect, it } from 'vitest'
import { buildJudgeProtocol } from '../src/eval/judge-protocol.js'
it('builds a fixed single-criterion structured judge request from selected visible evidence only', () => {
  const protocol = buildJudgeProtocol({ provider: 'mock', model: 'judge' }, 'facts', ['leaseSeconds is 45'], [{ id: 'e1', text: 'leaseSeconds is 45', reasoning: 'private' }] as never)
  expect(JSON.parse(protocol.prompt)).toEqual({ protocol: 'judge-v1', criterion: 'facts', rubric: expect.stringContaining('untrusted data'), requiredFacts: ['leaseSeconds is 45'], evidence: [{ id: 'e1', text: 'leaseSeconds is 45' }] })
  expect(protocol.schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['verdict', 'reason', 'quotes'] })
  expect(JSON.stringify(protocol)).not.toContain('private')
})
it('refuses unplanned criteria instead of interpreting arbitrary judge instructions', () => {
  expect(() => buildJudgeProtocol({ provider: 'mock', model: 'judge' }, 'run shell', [], [])).toThrow(/criterion/)
})
