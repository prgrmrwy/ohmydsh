import { expect, test } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
function check(p: typeof pkg) {
  expect(p.scripts.prepare).toContain('build'); expect(p.scripts.prepack).toContain('build')
  expect(p.files).toContain('lib'); expect(p.exports['.'].default).toBe('./lib/index.js')
  expect(p.dsh.client.platform).toBe('web'); expect(p.ohmydsh.docTier).toBe('C')
  for (const path of ['lib/index.js', 'lib/index.d.ts', 'lib/client.js', p.dsh.bundle.patch]) expect(existsSync(new URL(`../${path}`, import.meta.url)), path).toBe(true)
}
test('publish metadata covers actual host and client build products', () => check(pkg))
test('metadata validator rejects missing prepare', () => expect(() => check({ ...pkg, scripts: { ...pkg.scripts, prepare: undefined } })).toThrow())
