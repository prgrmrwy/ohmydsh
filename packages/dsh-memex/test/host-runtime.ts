import { createRequire } from 'node:module'
import { basename, isAbsolute } from 'node:path'
import { realpathSync, statSync } from 'node:fs'

export function hostTestRequire(manifest = process.env.MEMEX_TEST_HOST_PACKAGE) {
  if (manifest === undefined) return createRequire(new URL('../package.json', import.meta.url))
  if (!isAbsolute(manifest) || basename(manifest) !== 'package.json' || !statSync(manifest, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('MEMEX_TEST_HOST_PACKAGE must be an existing absolute package.json file')
  }
  return createRequire(realpathSync(manifest))
}
