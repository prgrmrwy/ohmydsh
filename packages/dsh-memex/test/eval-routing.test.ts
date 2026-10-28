import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createScopeResolver } from '../src/scope/resolver.js'
import { allocateAttempt, verifyAttemptRoute, materializeAttempt } from '../src/eval/routing.js'

const home = '/Users/selftest'
const root = join(home, '.dsh-memex-eval-runs')
function resolver(fallback = false) {
  return createScopeResolver({ homeDir: home, config: { workspaces: [
    { path: root, ...(fallback ? {} : { fallback: false as const }) },
    { path: join(root, 'nomem'), memory: false },
  ] }, gitRemote: () => undefined, gitRoot: cwd => cwd })
}

describe('unique eval execution route', () => {
  it('EVAL-009: 两次尝试路由到不同库', () => {
    const a = allocateAttempt(home, 'mem')
    const b = allocateAttempt(home, 'mem')
    const service = resolver()
    const ar = verifyAttemptRoute(service, a)
    const br = verifyAttemptRoute(service, b)
    expect(a.cwd).not.toBe(b.cwd)
    expect(ar.home).not.toBe(br.home)
    expect(ar.scope).toMatch(/^eval-/)
    expect(ar.access).toEqual({ current: ar.scope, read: [ar.scope], write: [ar.scope] })
    expect(ar.fallback).toBe(false)
    const n = verifyAttemptRoute(service, allocateAttempt(home, 'nomem'))
    expect(n.memory).toBe(false)
  })

  it('EVAL-010: personal 可达时拒绝', () => {
    expect(() => verifyAttemptRoute(resolver(true), allocateAttempt(home, 'mem'))).toThrow(/personal|fallback/)
  })

  it('EVAL-011: 旧身份不会重新指向新题', () => {
    const old = allocateAttempt(home, 'mem')
    const service = resolver()
    const before = verifyAttemptRoute(service, old)
    verifyAttemptRoute(service, allocateAttempt(home, 'mem'))
    expect(service.resolve(old.cwd)).toEqual(before)
  })

  it('materializes only repository input under cwd and cards under the derived home', () => {
    const homeDir = mkdtempSync(join(realpathSync(tmpdir()), 'eval-route-home-'))
    const attempt = allocateAttempt(homeDir, 'mem')
    mkdirSync(dirname(attempt.cwd), { recursive: true })
    mkdirSync(dirname(attempt.home), { recursive: true })
    materializeAttempt(new Map([
      ['repo/config.json', Buffer.from('{}')],
      ['library/cards/example.md', Buffer.from('fictional')],
      ['questions.json', Buffer.from('private gold')],
    ]), attempt)
    expect(readFileSync(join(attempt.cwd, 'config.json'), 'utf8')).toBe('{}')
    expect(readFileSync(join(attempt.home, 'cards/example.md'), 'utf8')).toBe('fictional')
    expect(existsSync(join(attempt.cwd, 'questions.json'))).toBe(false)
    expect(existsSync(join(dirname(attempt.cwd), 'questions.json'))).toBe(false)
  })

  it('rejects a colliding tail or configured shared home', () => {
    const attempt = allocateAttempt(home, 'mem')
    const shared = createScopeResolver({ homeDir: home, config: { scopes: [{ name: 'eval-shared', pathPrefixes: [root], fallback: false }] } })
    expect(() => verifyAttemptRoute(shared, attempt)).toThrow(/route mismatch/)
  })
})
