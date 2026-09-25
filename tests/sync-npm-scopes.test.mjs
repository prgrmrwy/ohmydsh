// npmScopes: a package entry declares the npm scopes its install needs; sync
// verifies each is configured (as npm itself resolves it, from the profile dir)
// before any customization is materialized, and never writes registry config.
//
// Uses the real `npm config get` — no network. The runner's own ~/.npmrc is
// excluded via npm_config_userconfig so it cannot satisfy a scope by accident.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { overlayFixture, snapshotTree } from './helpers/overlay-fixture.mjs'

const HEAD = 'dshVersion: 0.1.0-rc.7\n'
const remoteEntry = (id, spec, extra = '', enabled = true) =>
  `  - id: ${id}\n    type: package\n    source: remote\n    spec: '${spec}'\n    version: 1.0.0\n    enabled: ${enabled}\n${extra}`
const SCOPES = "    npmScopes: ['@example']\n"

async function scopeFixture(t, { manifest, initProfile = true } = {}) {
  const fx = await overlayFixture({ manifest, initProfile })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  const userconfig = path.join(fx.root, 'empty-user-npmrc')
  await writeFile(userconfig, '')
  // Every npm_config_* from an outer npm run is dropped: an inherited
  // `npm_config_@example:registry` would make the negative cases vacuous.
  const clean = Object.fromEntries(Object.keys(process.env).filter((k) => /^npm_config_/i.test(k)).map((k) => [k, undefined]))
  const sync = (args = [], extra = {}) => fx.sync(args, { ...clean, npm_config_userconfig: userconfig, ...extra })
  return { ...fx, sync }
}

const profileNpmrc = (fx, body) => writeFile(path.join(fx.profile, '.npmrc'), body)

test('malformed npmScopes is rejected at load', async (t) => {
  for (const value of ["['example']", "'@example'", '[42]', "['@Example/x']"]) {
    const fx = await scopeFixture(t)
    await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', `    npmScopes: ${value}\n`)}`)
    const before = await snapshotTree(fx.dshHome)
    const result = fx.sync()
    assert.notEqual(result.status, 0, `${value}: ${result.stdout}`)
    assert.match(result.stderr, /\(q\).*npmScopes|npmScopes.*\(q\)/, `${value}: ${result.stderr}`)
    assert.deepEqual(await snapshotTree(fx.dshHome), before, value)
  }
})

test('npmScopes on a non-package entry is rejected', async (t) => {
  const fx = await scopeFixture(t)
  await fx.writeOverlay(`customizations:\n  - id: p\n    type: patch\n    enabled: true\n${SCOPES}`)
  await fx.putOverlay('patches/p.yml', '- insert: []\n')
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /\(p\).*npmScopes|npmScopes.*\(p\)/)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

test('configured scope passes and .npmrc is untouched', async (t) => {
  const fx = await scopeFixture(t)
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES)}`)
  const npmrc = '@example:registry=http://127.0.0.1:9/\n'
  await profileNpmrc(fx, npmrc)
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal((await fx.profilePkg()).dependencies['@example/q'], '1.0.0')
  assert.equal(await readFile(path.join(fx.profile, '.npmrc'), 'utf8'), npmrc)
})

test('missing scope fails before dependency and package changes', async (t) => {
  const fx = await scopeFixture(t, { manifest: `${HEAD}dependencies:\n  - dsh-dep@1.0.0\ncustomizations:\n${remoteEntry('other', 'dsh-other@1.0.0')}` })
  assert.equal(fx.sync([], { DSH_LOCAL_MANIFEST: path.join(fx.root, 'none.yaml') }).status, 0)
  await fx.putPublic('dsh.yaml', `${HEAD}dependencies:\n  - dsh-dep@1.0.0\n  - dsh-new-dep@1.0.0\ncustomizations:\n${remoteEntry('other', 'dsh-other@1.0.0')}`)
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES)}`)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  for (const needle of ['@example', 'package q', fx.profile]) assert.ok(result.stderr.includes(needle), `${needle}: ${result.stderr}`)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

test('npm_config_registry does not count as a configured scope', async (t) => {
  const fx = await scopeFixture(t)
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES)}`)
  const result = fx.sync([], { npm_config_registry: 'http://127.0.0.1:9/' })
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /@example/)
})

test('missing scope on a fresh DSH_HOME installs nothing', async (t) => {
  const fx = await scopeFixture(t, { manifest: `${HEAD}dependencies:\n  - dsh-dep@1.0.0\ncustomizations: []\n`, initProfile: false })
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES)}`)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /@example/)
  if (existsSync(path.join(fx.profile, 'package.json'))) {
    assert.deepEqual((await fx.profilePkg()).dependencies ?? {}, {})
  }
  assert.doesNotMatch(await fx.actionLog(), /plugin/)
})

test('missing scope leaves the legacy ledger unmigrated', async (t) => {
  const fx = await scopeFixture(t)
  const legacy = path.join(fx.dshHome, '.ohmydsh-sync-state.json')
  await writeFile(legacy, '{}\n')
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES)}`)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.equal(existsSync(legacy), true)
  assert.equal(existsSync(path.join(fx.dshHome, '.dsh-sync-state.json')), false)
})

test('disabled entry scopes are not checked', async (t) => {
  const fx = await scopeFixture(t)
  await fx.writeOverlay(`customizations:\n${remoteEntry('q', '@example/q@1.0.0', SCOPES, false)}`)
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stderr, /@example/)
})
