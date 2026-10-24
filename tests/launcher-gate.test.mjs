import test from 'node:test'
import assert from 'node:assert/strict'
import { assertSecondBuildNoop } from '../openspec/changes/cross-platform-launcher/checking/full-gate-assertions.mjs'

test('full gate rejects successful second build unless sync explicitly reports no changes', () => {
  const good = { status: 0, stdout: '[sync] no changes — deployment already matches manifest\n', stderr: '' }
  assert.doesNotThrow(() => assertSecondBuildNoop(good))
  for (const result of [
    { ...good, status: 1 },
    { ...good, stdout: '' },
    { ...good, stdout: '[sync] done — 1 change(s) applied\n' },
    { ...good, stdout: good.stdout + '[sync] done — 1 change(s) applied\n' },
  ]) assert.throws(() => assertSecondBuildNoop(result), /second build|idempotent/)
})
