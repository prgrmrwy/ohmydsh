import { expect, it } from 'vitest'
import { evalFilter, sessionIdentityHash } from '../src/eval/filter.js'
// Standalone deployed skill has no package runtime dependency; compare its wire contract here.
// @ts-expect-error independent JavaScript skill does not publish declarations
import { filterEvalSessions } from '../../../skills/weekly-insights/scripts/insights.mjs'
it('package and standalone insights use the exact same registry hash and fallback contract', () => {
  const cwd = '/u/.dsh-memex-eval-runs/nomem/eval-12345678-1234-1234-1234-123456789abc/repo'
  const registry = JSON.stringify({ round: 'round-test', role: 'child', sessionHash: sessionIdentityHash('eval') }) + '\ninvalid\n'
  const headers = [{ id: 'eval', cwd: '/daily' }, { id: 'cwd', cwd }, { id: 'daily', cwd: '/work/evaluation/repo' }]
  const filtered = filterEvalSessions(headers.map(header => ({ header })), registry)
  const predicate = evalFilter(registry)
  expect(filtered.warning).toBe(predicate.warning)
  expect(filtered.sessions.map((s: { header: { id: string } }) => s.header.id)).toEqual(headers.filter(h => !predicate.exclude({ sessionId: h.id, cwd: h.cwd })).map(h => h.id))
})
it('insights recursively excludes a grandchild even when it precedes the parent and registry is corrupt', () => {
  const result = filterEvalSessions([
    { header: { id: 'grandchild', parentSession: 'child', cwd: '/elsewhere' } },
    { header: { id: 'child', parentSession: 'root', cwd: '/elsewhere' } },
    { header: { id: 'root', cwd: '/u/.dsh-memex-eval-runs/mem/eval-12345678-1234-1234-1234-123456789abc/repo' } },
    { header: { id: 'daily', cwd: '/elsewhere' } },
  ], 'invalid\n')
  expect(result.warning).toBe(true)
  expect(result.sessions.map((s: { header: { id: string } }) => s.header.id)).toEqual(['daily'])
})
