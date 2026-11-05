import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { hostTestRequire } from './host-runtime.js'

afterEach(() => vi.unstubAllEnvs())

it('defaults to the package-owned official Host graph', () => {
  vi.stubEnv('MEMEX_TEST_HOST_PACKAGE', undefined)
  expect(hostTestRequire()('@deepseek-ai/dsh-subagent/package.json').version).toBe('0.2.1-rc.5')
  expect(hostTestRequire()('@deepseek-ai/dsh-subagent/package.json').dsh_compat).toBeUndefined()
})

it('resolves an explicitly selected graph without falling back to the default', () => {
  const root = mkdtempSync(join(tmpdir(), 'memex-test-host-'))
  const manifest = join(root, 'package.json')
  writeFileSync(manifest, '{}')
  writeFileSync(join(root, 'marker.cjs'), 'module.exports = "selected-host"')
  expect(hostTestRequire(manifest)('./marker.cjs')).toBe('selected-host')
  expect(() => hostTestRequire(manifest).resolve('@deepseek-ai/dsh-subagent')).toThrow()
})

it('rejects relative, missing, directory and non-manifest selections', () => {
  const root = mkdtempSync(join(tmpdir(), 'memex-invalid-host-'))
  const other = join(root, 'other.json')
  writeFileSync(other, '{}')
  for (const input of ['', 'package.json', join(root, 'missing', 'package.json'), root, other]) {
    expect(() => hostTestRequire(input)).toThrow(/existing absolute package.json/)
  }
})
