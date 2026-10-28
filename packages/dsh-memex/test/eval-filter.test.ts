import { expect, it } from 'vitest'
import { evalFilter, sessionIdentityHash } from '../src/eval/filter.js'
it('excludes hashed registered identities including descendants, retaining same-result daily control', () => {
  const filter = evalFilter(JSON.stringify({ round: 'round-test', role: 'child', sessionHash: sessionIdentityHash('eval-child') }) + '\n')
  expect(filter.exclude({ sessionId: 'eval-child', cwd: '/ordinary' })).toBe(true)
  expect(filter.exclude({ sessionId: 'daily', cwd: '/ordinary' })).toBe(false)
})
it('malformed registry enables only the precise legacy eval cwd fallback and reports its warning', () => {
  const filter = evalFilter('broken-json\n')
  expect(filter.warning).toBe(true)
  expect(filter.exclude({ cwd: '/home/u/.dsh-memex-eval-runs/mem/eval-12345678-1234-1234-1234-123456789abc/repo' })).toBe(true)
  expect(filter.exclude({ cwd: '/work/project-eval/repo' })).toBe(false)
  expect(filter.exclude({ cwd: '/home/u/.dsh-memex-eval-runs/mem/daily/repo' })).toBe(false)
})
it('valid records survive a corrupt trailing registry line', () => {
  const filter = evalFilter(JSON.stringify({ round: 'round-test', role: 'reserved', sessionHash: sessionIdentityHash('reserved') }) + '\nbroken\n')
  expect(filter.warning).toBe(true)
  expect(filter.exclude({ sessionId: 'reserved' })).toBe(true)
})
