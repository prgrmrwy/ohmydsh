import { expect, it } from 'vitest'
import { detectBoundaryAccess } from '../src/eval/boundary.js'
import { renderSelftestReport } from '../src/eval/report.js'
import type { FixedRound } from '../src/eval/round.js'

const home = '/u'
const own = { cwd: '/u/.dsh-memex-eval-runs/mem/eval-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/repo', home: '/u/.dsh-memex/eval-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa-repo' }
const other = '/u/.dsh-memex-eval-runs/nomem/eval-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/repo/config.json'
const call = (seq: number, path: string, isError = false) => [
  { type: 'assistant/message', seq, data: { message: { content: [{ type: 'tool-call', id: `c${seq}`, name: 'read', arguments: JSON.stringify({ path }) }] } } },
  { type: 'tool/result', seq: seq + 1, data: { message: { role: 'tool', toolCallId: `c${seq}`, isError, content: [{ type: 'text', text: 'ok' }] } } },
]

it('EVAL-004: 观察到越界访问即污染', () => {
  const hits = detectBoundaryAccess([...call(0, '/u/.dsh-memex/personal/cards/real.md')] as never, { home, own })
  expect(hits).toEqual([{ seq: 1, tool: 'read', path: '/u/.dsh-memex/personal/cards/real.md', kind: 'real-library' }])
  // contaminated items are not scored, and the report says the defense is after-the-fact
  const plan = { id: 'round-x', version: 'selftest-v1', items: [{ id: 'know-mem', question: 'know', kind: 'Know', condition: 'mem', writebackApplicable: false }] } as FixedRound
  const report = renderSelftestReport(plan, { 'know-mem': { R: ['yes'], K: ['yes'], A: [], W: [], endpoint: ['yes'] } }, { contaminated: { 'know-mem': hits } })
  expect(report.markdown).toContain('| know-mem | 环境污染 |')
  expect(report.markdown).toContain('事后检测')
  expect(report.markdown).toContain('| 全部计划端到端 | 1 | 0 | 0 | 1 |')
  expect(report.exitCode).not.toBe(0)
})

it('flags answers, other conditions and nested real-library paths, but not the condition own workspace or library', () => {
  const events = [
    ...call(0, `${own.cwd}/config.json`),
    ...call(2, `${own.home}/cards/retry-limit.md`),
    ...call(4, '/u/.dsh-memex-eval/selftest/round-x/input.json'),
    ...call(6, other),
    ...call(8, '/u/.dsh-memex/personal/../personal/cards/x.md'),
  ]
  expect(detectBoundaryAccess(events as never, { home, own }).map(hit => hit.kind)).toEqual(['suite-answer', 'other-condition', 'real-library'])
})

it('derives the home from the fixed attempt layout and refuses any other workspace', async () => {
  const { attemptHome } = await import('../src/eval/host-item.js')
  expect(attemptHome('/u/.dsh-memex-eval-runs/mem/eval-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/repo')).toBe('/u')
  for (const bad of ['/u/work/repo', '/u/.dsh-memex-eval-runs/other/eval-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/repo', '/u/.dsh-memex-eval-runs/mem/eval-x/repo']) {
    expect(() => attemptHome(bad)).toThrow(/layout/)
  }
})

it('failed tool calls and paths that are merely mentioned in text are not access', () => {
  const events = [
    ...call(0, '/u/.dsh-memex/personal/cards/real.md', true),
    { type: 'assistant/message', seq: 2, data: { message: { content: [{ type: 'text', text: 'I will not read /u/.dsh-memex/personal' }] } } },
  ]
  expect(detectBoundaryAccess(events as never, { home, own })).toEqual([])
})
