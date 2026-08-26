import test from 'node:test'
import assert from 'node:assert/strict'
import { federationFixtureContentViolations, federationFixtureViolations } from '../scripts/check-federation-fixtures.mjs'

const required = [
  'package-lock.json',
  'archify-out/ohmydsh-architecture.json',
  'archify-out/ohmydsh-architecture.dual.svg',
]
const base = 'openspec/changes/federated-dsh-control-plane/checking'

test('checked-in federation protocol, UI and compatibility fixtures pass privacy policy', async () => {
  const files = [
    ...required,
    `${base}/protocol/rc2-route-inventory.json`,
    `${base}/protocol/rc2-typert-route-inventory.json`,
    `${base}/protocol/rc2-synthetic-frames.json`,
    `${base}/ui-fixtures/rc2-node-sections.synthetic.json`,
    `${base}/compatibility/rc2-matrix.json`,
  ]
  assert.deepEqual(await federationFixtureViolations(files), [])
})

test('fixture policy detects real-home paths, credentials and missing synthetic declaration', () => {
  const file = `${base}/ui-fixtures/policy-invalid.fixture.json`
  const violations = federationFixtureContentViolations(file, JSON.stringify({
    path: '/Users/example/.dsh/private',
    authorization: 'Authorization: Bearer example-token-value-123456',
  }))
  assert.ok(violations.some(value => /synthetic-secret-free/.test(value)))
  assert.ok(violations.some(value => /home path/.test(value)))
  assert.ok(violations.some(value => /bearer credential/.test(value)))
})
