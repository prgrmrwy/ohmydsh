import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { defineConfig } from 'vitest/config'

// Explicit opt-in only. The usual suite tests unsupported-storage rejection;
// this config exercises actual reviewed Domain transactions with a memory medium.
const input = process.env.DSH_PET_TEST_RUNTIME
if (!input || !isAbsolute(input)) throw new Error('DSH_PET_TEST_RUNTIME must be an absolute reviewed launcher root')
const root = realpathSync(input)
const aliases = ['cordis', 'dsh-storage', 'dsh-storage-domain'].map(name => {
  const directory = realpathSync(join(root, 'node_modules/@deepseek-ai', name))
  const rel = relative(root, directory)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Runtime package escapes reviewed root')
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (pkg.name !== `@deepseek-ai/${name}` || pkg.version !== (name === 'cordis' ? '4.0.2' : '0.1.2-rc.1-locus-atomic.1')) throw new Error('Unreviewed runtime version')
  if (name !== 'cordis' && (pkg.dsh_compat?.upstreamBase !== 'a66e4702047846cdaa10c66c9d3df3951f5ea70d' || pkg.dsh_compat?.patchSha256 !== '18ec93c5240612b513871d65db2d100ee6165ea1ba251dbf91e670963dd35bed')) throw new Error('Unreviewed storage compatibility provenance')
  return { find: `@deepseek-ai/${name}`, replacement: join(directory, pkg.main) }
})

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    include: [
      'test/collaboration-context-store.test.ts',
      'test/inquiry-ledger-store.test.ts',
      'test/inquiry-outbox-store.test.ts',
      'test/ledger-store.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    env: { DSH_PET_TEST_ATOMIC_DOMAIN: '1' },
  },
})
