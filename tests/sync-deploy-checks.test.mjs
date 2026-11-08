import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runDeployChecks } from '../scripts/lib/deploy-checks.mjs'

function profileWith(name, pkg, files = {}) {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'deploy-checks-'))
  const dir = path.join(profileDir, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  for (const [file, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), body)
  }
  return profileDir
}

const declared = (bin) => ({ name: 'pkg', bin: { tool: 'bin/tool.mjs' }, ohmydsh: { deployChecks: [{ bin, args: ['--self-check'] }] } })

test('a declared bin that loads standalone passes', () => {
  const profileDir = profileWith('pkg', declared('tool'), { 'bin/tool.mjs': "if (process.argv[2] !== '--self-check') process.exit(3)\n" })
  assert.deepEqual(runDeployChecks(['pkg'], { profileDir }), { passed: ['pkg: tool --self-check'], failed: [] })
})

test('a bin that cannot resolve its imports from the deployed copy fails with the reason', () => {
  const profileDir = profileWith('pkg', declared('tool'), { 'bin/tool.mjs': "await import('@absent/host-peer')\n" })
  const { passed, failed } = runDeployChecks(['pkg'], { profileDir })
  assert.deepEqual(passed, [])
  assert.equal(failed.length, 1)
  assert.match(failed[0], /^pkg: tool --self-check: .*@absent\/host-peer/)
})

test('an undeclared bin name fails; packages without checks or not deployed are skipped', () => {
  const profileDir = profileWith('pkg', declared('missing'))
  assert.deepEqual(runDeployChecks(['pkg', 'not-deployed'], { profileDir }).failed, ['pkg: missing --self-check: bin is not declared by the package'])
  const plain = profileWith('plain', { name: 'plain' })
  assert.deepEqual(runDeployChecks(['plain'], { profileDir: plain }), { passed: [], failed: [] })
})
