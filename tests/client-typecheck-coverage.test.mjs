import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every package whose client half is typechecked must actually include
 * `src/client` in that program.
 *
 * The base `tsconfig.json` excludes `src/client` (the host build must not
 * compile browser code). A `tsconfig.client.json` that only sets `include`
 * inherits that `exclude`, and the two cancel out: `tsc` then compiles none of
 * the client sources and exits 0 — a typecheck that checks nothing.
 *
 * This is not hypothetical: `worktree-session` and
 * `sidebar-session-provider-icon` shipped that way, which is how a client
 * component kept destructuring a slot prop the runtime no longer provides
 * (the DSH 0.1.2 `useSessions` regression) without any check failing.
 */
test('every client tsconfig actually includes its client sources', () => {
  const dir = path.join(REPO, 'packages')
  const offenders = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const clientConfig = path.join(dir, entry.name, 'tsconfig.client.json')
    const clientSrc = path.join(dir, entry.name, 'src', 'client')
    if (!existsSync(clientConfig) || !existsSync(clientSrc)) continue

    const config = JSON.parse(readFileSync(clientConfig, 'utf8'))
    const base = config.extends === undefined
      ? {}
      : JSON.parse(readFileSync(path.resolve(path.dirname(clientConfig), config.extends), 'utf8'))
    const inheritedExclude = config.exclude ?? base.exclude ?? []
    const excludesClient = inheritedExclude.some(pattern => pattern.replace(/\/+$/, '') === 'src/client')
    if (excludesClient) offenders.push(`${entry.name}: tsconfig.client.json resolves exclude=${JSON.stringify(inheritedExclude)}, which cancels its include`)
  }
  assert.deepEqual(offenders, [], `client typecheck compiles no client sources:\n  ${offenders.join('\n  ')}`)
})
