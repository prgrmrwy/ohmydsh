import { createRequire } from 'node:module'
import { basename, isAbsolute } from 'node:path'
import { readFileSync, realpathSync, statSync } from 'node:fs'

export function hostTestRequire(manifest = process.env.MEMEX_TEST_HOST_PACKAGE) {
  if (manifest === undefined) return createRequire(new URL('../package.json', import.meta.url))
  if (!isAbsolute(manifest) || basename(manifest) !== 'package.json' || !statSync(manifest, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('MEMEX_TEST_HOST_PACKAGE must be an existing absolute package.json file')
  }
  return createRequire(realpathSync(manifest))
}

/** The Host version this repository pins (`dshVersion` in the root dsh.yaml), the single version source. */
export function expectedDshVersion(): string {
  const manifest = readFileSync(new URL('../../../dsh.yaml', import.meta.url), 'utf8')
  const match = /^dshVersion:\s*['"]?([^\s'"#]+)/m.exec(manifest)
  if (match === null) throw new Error('dshVersion missing from dsh.yaml')
  return match[1]!
}
