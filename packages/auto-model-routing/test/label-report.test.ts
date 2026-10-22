import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const script = resolve(import.meta.dirname, '../scripts/label-report.mjs')

it('report_folds_by_version_and_skips_bad_lines', () => {
 const file = join(mkdtempSync(join(tmpdir(), 'label-report-')), 'judgements.jsonl')
 const lines = [
  { sessionId: 'S1', turn: 1, tier: 'complex', effort: 'high', model: 'm', rubricVersion: 'a' },
  { sessionId: 'S1', turn: 1, label: 'standard' },
  { sessionId: 'S1', turn: 2, tier: 'simple', effort: 'low', model: 'm', rubricVersion: 'a' },
  { sessionId: 'S1', turn: 2, label: 'simple' },
  { sessionId: 'S1', turn: 3, tier: 'standard', model: 'm', rubricVersion: 'a' },
  { sessionId: 'S2', turn: 1, tier: 'standard', effort: 'medium', model: 'm', rubricVersion: 'b' },
  { sessionId: 'S2', turn: 1, label: 'simple' },
  { sessionId: 'S2', turn: 1, label: 'complex' },
 ].map(line => JSON.stringify(line))
 lines.splice(3, 0, '{"sessionId":"S1","tu')
 writeFileSync(file, lines.join('\n') + '\n')
 const before = readFileSync(file, 'utf8'); const mtime = statSync(file).mtimeMs
 const out = JSON.parse(execFileSync(process.execPath, [script, '--file', file, '--json'], { encoding: 'utf8' }))
 expect(out.versions.a).toEqual({ labeled: 2, agree: 1, over: 1, under: 0 })
 expect(out.versions.b).toEqual({ labeled: 1, agree: 0, over: 0, under: 1 })
 expect(out.mismatches).toEqual([
  { sessionId: 'S1', turn: 1, rubricVersion: 'a', tier: 'complex', label: 'standard' },
  { sessionId: 'S2', turn: 1, rubricVersion: 'b', tier: 'standard', label: 'complex' },
 ])
 expect(readFileSync(file, 'utf8')).toBe(before)
 expect(statSync(file).mtimeMs).toBe(mtime)
})
