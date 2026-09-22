import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('worktree-session stays independent from cockpit integration', () => {
  const files = [
    'packages/worktree-session/package.json',
    'packages/worktree-session/src/open-handler.ts',
    'packages/worktree-session/src/client/index.tsx',
    'packages/worktree-session/src/client/controls.tsx',
  ]
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(source, /dsh-cockpit|cockpitBridge|cockpit-worktree/iu, file)
  }
})

test('the shim is optional and reads both exact dotted service names', () => {
  const source = read('packages/cockpit-worktree-open-shim/src/client/index.ts')
  assert.match(source, /ctx\.get\(COCKPIT_EDITOR_OPEN_SERVICE\)/u)
  assert.match(source, /ctx\.get\(WORKTREE_OPEN_HANDLER_SERVICE\)/u)
  assert.doesNotMatch(source, /ctx\.get\(['"]cockpitBridge['"]\)\s*\./u)
  assert.doesNotMatch(source, /ctx\.get\(['"]worktreeSession['"]\)\s*\./u)
  assert.match(source, /export const inject: string\[\] = \[\]/u)
})
