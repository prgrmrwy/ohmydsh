import test from 'node:test'
import assert from 'node:assert/strict'
import { artifactPolicyViolations, REQUIRED_TRACKED_PATHS } from '../scripts/check-tracked-artifacts.mjs'

const allowed = [
  ...REQUIRED_TRACKED_PATHS,
  'packages/worktree-session/src/index.ts',
  'packages/subscriptions-sandbox-shim/src/index.js',
  'openspec/changes/example/checking/report.md',
  'openspec/changes/example/checking/trails/T1.md',
  'worktree-session-architecture.md',
]

test('allows root lock, selected architecture assets, source, and summarized evidence', () => {
  assert.deepEqual(artifactPolicyViolations(allowed), [])
})

test('rejects generated package output and nested locks', () => {
  const violations = artifactPolicyViolations([
    ...allowed,
    'packages/worktree-session/lib/index.js',
    'packages/worktree-session/package-lock.json',
  ])
  assert.equal(violations.length, 2)
  assert.match(violations[0], /generated package lib/)
  assert.match(violations[1], /nested package lock/)
})

test('rejects raw checking evidence and duplicate architecture exports', () => {
  const violations = artifactPolicyViolations([
    ...allowed,
    'openspec/changes/example/checking/baselines/history.json',
    'openspec/changes/example/checking/screenshots/gui.png',
    'archify-out/ohmydsh-architecture.light.png',
    'archify-out/ohmydsh-architecture.html',
    'worktree-session-architecture.html',
  ])
  assert.equal(violations.length, 5)
})

test('requires the root lock and architecture source/display allowlist', () => {
  const violations = artifactPolicyViolations(['README.md'])
  for (const required of REQUIRED_TRACKED_PATHS) {
    assert.ok(violations.some((entry) => entry.startsWith(`${required}:`)), required)
  }
})
