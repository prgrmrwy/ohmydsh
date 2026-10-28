import { mkdtempSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { registerFixedRound } from '../src/eval/round.js'
import { runEvalReportCli } from '../src/cli/eval-report.js'
it('outputs the complete offline Markdown and propagates incomplete exit without writes', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'eval-report-cli-'))
  const plan = registerFixedRound(root, { version: 'selftest-v1', tested: { provider: 'mock', model: 'test' }, judge: { provider: 'mock', model: 'judge' }, maxJudgeCalls: 12 })
  const before = readdirSync(root, { recursive: true }), output: string[] = [], errors: string[] = []
  expect(runEvalReportCli(['--root', root, '--round', plan.id], { out: text => output.push(text), error: text => errors.push(text) })).toBe(1)
  expect(output.join('')).toContain('| 全部计划端到端 | 6 | 0 | 0 | 6 |')
  expect(errors).toEqual([])
  expect(readdirSync(root, { recursive: true })).toEqual(before)
})
it('rejects unknown, duplicate, missing arguments and arbitrary suites without doing work', () => {
  for (const args of [[], ['--suite', 'business'], ['--root', '/tmp'], ['--root', '/tmp', '--root', '/other', '--round', 'x'], ['--root', '/tmp', '--round', '../daily'], ['--help', '--run']]) {
    const output: string[] = [], errors: string[] = []
    expect(runEvalReportCli(args, { out: text => output.push(text), error: text => errors.push(text) })).toBe(2)
    expect(output).toEqual([])
    expect(errors).toHaveLength(1)
  }
})
it('help describes only offline fixed selftest artifacts', () => {
  const output: string[] = []
  expect(runEvalReportCli(['--help'], { out: text => output.push(text), error: () => { throw new Error('unexpected') } })).toBe(0)
  expect(output.join('')).toContain('离线')
})
