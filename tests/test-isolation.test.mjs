// `npm test` must never read the runner's own overlay (spec: 仓库测试与本机 overlay 隔离).
//
// Exercised end to end: a throwaway copy of the repository's real `package.json`
// runs `npm test` against a single probe test, so the assertion is on what the
// actual test entry point hands to test processes — not on the script text.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { REPO } from './helpers/overlay-fixture.mjs'

async function probeRepo(probeBody) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-isolation-'))
  await writeFile(path.join(root, 'package.json'), await readFile(path.join(REPO, 'package.json')))
  await cp(path.join(REPO, 'scripts', 'lib'), path.join(root, 'scripts', 'lib'), { recursive: true })
  await symlink(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  await mkdir(path.join(root, 'tests'), { recursive: true })
  await writeFile(path.join(root, 'tests', 'probe.test.mjs'), probeBody)
  return root
}

function npmTest(cwd, env) {
  // npm_lifecycle_* / npm_config_* from an outer `npm test` would leak into the
  // child and could redirect it. NODE_TEST_CONTEXT is set by the outer test
  // runner and makes a nested `node --test` report to its parent instead of
  // running normally (it then exits 0 regardless of the probe's verdict).
  const clean = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^npm_/i.test(key) && key !== 'NODE_TEST_CONTEXT'))
  return spawnSync('npm', ['test', '--silent'], { cwd, encoding: 'utf8', env: { ...clean, ...env } })
}

test('npm test masks an exported DSH_LOCAL_MANIFEST', async (t) => {
  const outer = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-isolation-overlay-'))
  const overlay = path.join(outer, 'dsh.yaml.local')
  await writeFile(overlay, 'customizations: []\n')
  const root = await probeRepo(`
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
test('probe', () => {
  const value = process.env.DSH_LOCAL_MANIFEST
  assert.ok(typeof value === 'string' && path.isAbsolute(value), 'expected an absolute path, got ' + JSON.stringify(value))
  assert.equal(existsSync(value), false, 'test processes must see a nonexistent overlay path, got ' + value)
})
`)
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(outer, { recursive: true, force: true })]))
  const result = npmTest(root, { DSH_LOCAL_MANIFEST: overlay })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('a broken repo-root overlay does not reach tests', async (t) => {
  const root = await probeRepo(`
import test from 'node:test'
import { loadOverlayCustomizations } from '../scripts/lib/manifest-overlay.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
test('probe', () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  loadOverlayCustomizations({ repo, env: process.env, strict: true })
})
`)
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'dsh.yaml.local'), 'dshVersion: 9.9.9\n')
  const result = npmTest(root, { DSH_LOCAL_MANIFEST: '' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
