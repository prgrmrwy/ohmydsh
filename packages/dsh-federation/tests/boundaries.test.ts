import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CORE = path.resolve(import.meta.dirname, '../src/core')
const FORBIDDEN = [
  '@deepseek-ai/cordis',
  'react',
  'node:fs',
  'node:http',
  'node:https',
  'node:net',
  'node:child_process',
  'ws',
  'ssh',
  '@deepseek-ai/dsh-',
]

function files(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const target = path.join(root, name)
    return statSync(target).isDirectory() ? files(target) : [target]
  }).filter(file => /\.tsx?$/.test(file))
}

describe('stable Core import boundary', () => {
  it('does not import runtime, transport, filesystem, UI or DSH wire packages', () => {
    for (const file of files(CORE)) {
      const source = readFileSync(file, 'utf8')
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2])
      for (const forbidden of FORBIDDEN) {
        const matches = forbidden.endsWith('-')
          ? (specifier: string) => specifier.startsWith(forbidden)
          : (specifier: string) => specifier === forbidden || specifier.startsWith(`${forbidden}/`)
        expect(specifiers.some(matches), `${file} imports ${forbidden}`).toBe(false)
      }
    }
  })
})

describe('rc.2 method allowlist boundary', () => {
  it('sends only hardcoded, allowlisted method names', async () => {
    // The dispatcher's runtime allowlist check cannot be exercised while every
    // call site passes a literal, so pin that structural property instead: a
    // future dynamic method name must fail this test loudly rather than silently
    // rely on an untestable guard.
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/host/remote-adapter/rc2/index.ts'), 'utf8')
    const { RC2_ALLOWED_METHODS, RC2_FORBIDDEN_METHODS } = await import('../src/host/remote-adapter/rc2/index.js')

    // `this.#call(` are the call sites; `#call(method: string` is the declaration.
    const calls = [...source.matchAll(/this\.#call\(\s*(.)/g)].map(match => match[1])
    expect(calls.length).toBeGreaterThan(0)
    for (const opener of calls) {
      expect(opener, 'every #call must pass a single-quoted literal method name').toBe("'")
    }
    // `probeOptional` forwards a variable method, so the runtime allowlist guard
    // is genuinely reachable there; every other rpc() site is a literal.
    const rpcOpeners = [...source.matchAll(/await rpc\(carrier,\s*(.)/g)].map(match => match[1])
    const dynamic = rpcOpeners.filter(opener => opener !== "'")
    expect(dynamic.length, 'only probeOptional may forward a dynamic method').toBe(1)

    const literals = new Set([
      ...[...source.matchAll(/#call\('([^']+)'/g)].map(match => match[1]),
      ...[...source.matchAll(/\brpc\(carrier,\s*'([^']+)'/g)].map(match => match[1]),
    ])
    expect(literals.size).toBeGreaterThan(10)
    for (const method of literals) {
      expect(RC2_ALLOWED_METHODS.has(method), `${method} is sent but not allowlisted`).toBe(true)
      expect(RC2_FORBIDDEN_METHODS).not.toContain(method)
    }
  })
})
