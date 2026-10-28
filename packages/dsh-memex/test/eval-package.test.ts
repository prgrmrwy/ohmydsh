import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
it('declares the offline report executable and sets its built mode without requiring deployment', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.bin['dsh-memex-eval-report']).toBe('./lib/cli/eval-report.js')
  expect(manifest.scripts['build:host']).toContain("chmodSync('lib/cli/eval-report.js',0o755)")
})
it('ships hash-verified fictional fixtures alongside built eval modules', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(manifest.files).toContain('fixtures/eval')
})
