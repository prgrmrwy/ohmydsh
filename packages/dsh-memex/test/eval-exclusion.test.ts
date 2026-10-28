import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { buildReport } from '../src/telemetry/report.js'
import { sessionIdentityHash } from '../src/eval/filter.js'
// @ts-expect-error independent JavaScript skill does not publish declarations
import { filterEvalSessions } from '../../../skills/weekly-insights/scripts/insights.mjs'

const evalCwd = '/u/.dsh-memex-eval-runs/mem/eval-12345678-1234-1234-1234-123456789abc/repo'

it('EVAL-047: 三消费端排除', () => {
  const registry = JSON.stringify({ round: 'round-x', role: 'child', sessionHash: sessionIdentityHash('registered') }) + '\n'
  const now = new Date('2026-10-28T00:00:00Z'), at = '2026-10-27T00:00:00Z'
  const report = buildReport({ evalRegistry: registry, corruptLines: 0, scope: 'personal', cards: [], days: 7, now, records: [
    { at, session: sessionIdentityHash('registered'), scope: 'personal', hits: [] },
    { at, session: sessionIdentityHash('daily'), scope: 'eval-abc-repo', hits: [] },
    { at, session: sessionIdentityHash('daily'), scope: 'personal', hits: [] },
  ] })
  expect(report.recalls).toBe(1)
  expect(report.excludedEval).toBe(2)

  const home = mkdtempSync(join(tmpdir(), 'eval-exclusion-'))
  const bin = join(home, 'bin'); mkdirSync(bin)
  writeFileSync(join(bin, 'dsh-memex-recall-report'), '#!/bin/bash\nprintf "CALL:%s\\n" "$*"\n', { mode: 0o700 })
  for (const lib of ['personal', 'eval-1-repo', 'eval-2-repo']) mkdirSync(join(home, '.dsh-memex', lib, 'cards'), { recursive: true })
  const run = spawnSync('bash', [resolve('../../skills/memex-recall-report/scripts/report.sh')], { env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' })
  expect(run.status).toBe(0)
  expect(run.stdout).not.toContain('eval-1-repo')
  expect(run.stderr).toContain('skipped 2 eval libraries')

  const insights = filterEvalSessions([
    { header: { id: 'root', cwd: evalCwd } },
    { header: { id: 'child', parentSession: 'root', cwd: '/elsewhere' } },
    { header: { id: 'daily', cwd: '/work' } },
  ], '')
  expect(insights.sessions.map((s: { header: { id: string } }) => s.header.id)).toEqual(['daily'])
  expect(insights.excluded).toBe(2)
})

it('EVAL-048: 登记损坏使用后备规则', () => {
  const result = filterEvalSessions([
    { header: { id: 'root', cwd: evalCwd } },
    { header: { id: 'grandchild', parentSession: 'child', cwd: '/x' } },
    { header: { id: 'child', parentSession: 'root', cwd: '/x' } },
    { header: { id: 'daily', cwd: '/work' } },
  ], '{not json\n')
  expect(result.warning).toBe(true)
  expect(result.excluded).toBe(3)
  expect(result.sessions.map((s: { header: { id: string } }) => s.header.id)).toEqual(['daily'])
})
