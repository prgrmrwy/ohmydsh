import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('ships an executable selftest entry with explicit operator authentication and no credential argv/discovery', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.bin['dsh-memex-eval-selftest']).toBe('./lib/cli/eval-selftest.js')
  const source = readFileSync(new URL('../src/cli/eval-selftest.ts', import.meta.url), 'utf8')
  expect(source.startsWith('#!/usr/bin/env node')).toBe(true)
  expect(source).toContain('authenticatedEvalClient')
  expect(source).toContain('setRawMode')
  expect(source).not.toMatch(/\.dsh\/logs|cookies\.sqlite|--token|--cookie|--launch-url/)
})
