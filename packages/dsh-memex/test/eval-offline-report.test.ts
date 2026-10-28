import { mkdtempSync, realpathSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
const packagedReads = vi.hoisted(() => [] as string[])
vi.mock('../src/eval/fixtures.js', async original => {
  const actual = await original<typeof import('../src/eval/fixtures.js')>()
  return { ...actual, validateFixture: (source: string, manifest: Parameters<typeof actual.validateFixture>[1]) => { packagedReads.push(source); return actual.validateFixture(source, manifest) } }
})
import { registerFixedRound } from '../src/eval/round.js'
import { DefaultModelNotice } from '../src/eval/default-model.js'
import { EvalLedger } from '../src/eval/ledger.js'
import { freezeSelection } from '../src/eval/selection.js'
import { freezeInput } from '../src/eval/freeze.js'
import { buildOfflineReport } from '../src/eval/offline-report.js'
it('EVAL-012 (report level): the report is regenerated from the frozen copy without reading packaged questions', async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-frozen-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const before = buildOfflineReport(root, plan.id)
  packagedReads.length = 0
  expect(buildOfflineReport(root, plan.id)).toEqual(before)
  expect(packagedReads).toEqual([])
})

it('refuses hash-valid malformed cost audits rather than interpolating unsafe or inconsistent fields', () => {
  for (const patch of [{ inputTokens: -1 }, { status: 'invented' }, { sessions: ['root', 'root'] }, { tokenCategories: { uncachedInput: 1, cacheRead: 1, cacheWrite: 1 } }, { toolCalls: -1 }, { toolCalls: 0.5 }, { observedRoutes: {} }, { observedRoutes: [{ session: 'daily', provider: 'p', model: 'm', requests: 1 }] }, { observedRoutes: [{ session: 'root', provider: 'p', model: 'm', requests: 0 }] }, { observedRoutes: [{ session: 'root', provider: 'p', model: 'm', requests: 1, unexpected: true }] }, { extra: true }]) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-bad-audit-'))
    const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
    const directory = join(root, plan.id, 'know-mem'); mkdirSync(directory)
    freezeInput(join(directory, 'execution-audit'), { status: 'valid', inputTokens: 15, outputTokens: 2, sessions: ['root'], ...patch })
    expect(() => buildOfflineReport(root, plan.id)).toThrow(/audit/)
  }
})
it('refuses hash-valid malformed boundary diagnostics rather than rendering arbitrary data', () => {
  for (const hits of [{}, [null], [{ seq: -1, tool: 'read', path: '/fictional', kind: 'real-library' }], [{ seq: 1, tool: 'read', path: '/fictional', kind: 'invented' }], [{ seq: 1, tool: 'read', path: '/fictional', kind: 'real-library', extra: true }]]) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-bad-boundary-'))
    const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
    const directory = join(root, plan.id, 'know-mem'); mkdirSync(directory)
    freezeInput(join(directory, 'boundary-hits'), hits)
    expect(() => buildOfflineReport(root, plan.id)).toThrow(/boundary/)
  }
})

it('rejects structurally valid audits containing foreign sessions or missing registered descendants', () => {
  for (const foreign of [true, false]) {
    const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-lineage-'))
    const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
    const directory = join(root, plan.id, 'know-mem'); mkdirSync(directory)
    const ledger = new EvalLedger(join(root, plan.id)), session = ledger.reserve(plan.id, 'know', 'mem')
    ledger.recordChild(session, 'registered-child')
    freezeInput(join(directory, 'attempt'), { session, attempt: { condition: 'mem' } })
    freezeInput(join(directory, 'execution-audit'), { status: 'valid', inputTokens: 1, outputTokens: 1, sessions: foreign ? [session, 'daily'] : [session] })
    expect(() => buildOfflineReport(root, plan.id)).toThrow(/identity|lineage/)
  }
})
it('reads the persisted before-default warning without pretending to know the current Host value or restoring it', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-default-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const notice = new DefaultModelNotice(join(root, plan.id)); notice.begin({ provider: 'mock', model: 'before-model' })
  const report = buildOfflineReport(root, plan.id)
  expect(report.markdown).toContain('before-model')
  expect(report.markdown).toContain('当前默认值：unknown（离线未读取 Host）')
  expect(report.markdown).toContain('工具不会自动写回')
  notice.confirm()
  expect(buildOfflineReport(root, plan.id).markdown).toContain('已记录人工确认；不证明当前默认值已恢复')
})
it('builds a deterministic read-only report for all six conditions with partial selection and no fabricated usage', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-offline-report-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const directory = join(root, plan.id, plan.items[0]!.id); mkdirSync(directory)
  freezeSelection(join(directory, 'selection'), [{ id: 'root:1', text: 'answer' }, { id: 'root:2', text: 'omitted' }], ['root:1'])
  const ledger = new EvalLedger(join(root, plan.id)), session = ledger.reserve(plan.id, 'know', 'mem')
  ledger.recordChild(session, 'child')
  freezeInput(join(directory, 'attempt'), { session, attempt: { condition: 'mem' } })
  freezeInput(join(directory, 'execution-audit'), { status: 'valid', inputTokens: 15, outputTokens: 2, sessions: [session, 'child'], tokenCategories: { uncachedInput: 2, cacheRead: 10, cacheWrite: 3 } })
  const before = readdirSync(join(root, plan.id), { recursive: true })
  const result = buildOfflineReport(root, plan.id)
  expect(result).toEqual(buildOfflineReport(root, plan.id))
  expect(result.exitCode).toBe(1)
  expect(result.markdown).toContain('| 全部计划端到端 | 6 | 0 | 0 | 6 |')
  expect(result.markdown).toContain('| know-mem | 2 | 1 | 1 | unknown | unknown |')
  expect(result.markdown).toContain('裁判成本：unknown')
  expect(result.markdown).toContain('| know-mem | valid | 2 | 15 | 2 | 10 | 3 | 2 |')
  expect(readdirSync(join(root, plan.id), { recursive: true })).toEqual(before)
})
