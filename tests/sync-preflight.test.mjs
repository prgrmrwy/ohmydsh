// Source preflight: every enabled entry's sources are resolved, checked and
// containment-proven before sync writes anything under $DSH_HOME. Without it a
// private repo that is not cloned (or on another branch) silently strips its
// patches from the profile while sync "only" exits non-zero (design D7).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture, snapshotTree, localPackageJson } from './helpers/overlay-fixture.mjs'

const HEAD = 'dshVersion: 0.1.0-rc.7\n'
const patchEntry = (id) => `  - id: ${id}\n    type: patch\n    enabled: true\n`
const skillEntry = (id) => `  - id: ${id}\n    type: skill\n    enabled: true\n`
const localEntry = (id, extra = '', enabled = true) =>
  `  - id: ${id}\n    type: package\n    source: local\n    version: 1.0.0\n    enabled: ${enabled}\n${extra}`

function cleanup(t, fx) {
  t.after(() => rm(fx.root, { recursive: true, force: true }))
}

async function readPatchBytes(fx) {
  return readFile(path.join(fx.profile, 'cordis.patch.yml'))
}

test('missing overlay patch fails before rewriting cordis.patch.yml', async (t) => {
  const fx = await overlayFixture()
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}`)
  const privatePatch = await fx.putOverlay('patches/p.yml', '- insert: [] # PRIVATE\n')
  await fx.putPublic('patches/p.yml', '- insert: [] # PUBLIC_DECOY\n')
  assert.equal(fx.sync().status, 0)
  const before = await readPatchBytes(fx)
  assert.match(before.toString(), /fragment: p/)

  await rm(privatePatch)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.ok(result.stderr.includes(privatePatch), result.stderr)
  assert.deepEqual(await readPatchBytes(fx), before)
})

test('missing public skill fails before any materialization', async (t) => {
  const fx = await overlayFixture({ manifest: `${HEAD}dependencies: []\ncustomizations:\n${patchEntry('p')}${skillEntry('s')}` })
  cleanup(t, fx)
  await fx.putPublic('patches/p.yml', '- insert: [] # V1\n')
  await fx.putPublic('skills/s/SKILL.md', '# s\n')
  assert.equal(fx.sync().status, 0)
  const before = await readPatchBytes(fx)

  await fx.putPublic('patches/p.yml', '- insert: [] # V2\n')
  await rm(path.join(fx.repo, 'skills', 's', 'SKILL.md'))
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.ok(result.stderr.includes(path.join(fx.repo, 'skills', 's', 'SKILL.md')), result.stderr)
  assert.deepEqual(await readPatchBytes(fx), before)
})

test('symlinked patch escaping its root is rejected', async (t) => {
  const fx = await overlayFixture()
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}`)
  const outside = path.join(fx.root, 'outside.yml')
  await writeFile(outside, '- insert: [] # OUTSIDE\n')
  await fx.putOverlay('patches/.keep', '')
  await symlink(outside, path.join(fx.overlayRoot, 'patches', 'p.yml'))
  await fx.sync([], { DSH_LOCAL_MANIFEST: path.join(fx.root, 'none.yaml') })
  const before = await readPatchBytes(fx)

  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /patch p/)
  assert.match(result.stderr, /outside/)
  assert.ok(result.stderr.includes(fx.overlayRoot), result.stderr)
  assert.deepEqual(await readPatchBytes(fx), before)
})

test('missing or escaping compat dependency fails before dependency sync', async (t) => {
  for (const variant of ['missing', 'escaping']) {
    const fx = await overlayFixture({ manifest: `${HEAD}dependencies:\n  - dsh-new-dep@1.0.0\ncustomizations: []\n` })
    cleanup(t, fx)
    await fx.writeOverlay(`customizations:\n${localEntry('q', '    compatDependencies:\n      - name: dsh-compat-c\n        path: vendor/c\n')}`)
    await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-q'))
    await fx.putOverlay('packages/q/index.js', 'export default 1\n')
    if (variant === 'escaping') {
      const outside = path.join(fx.root, 'outside-c')
      await fx.putPublic('../outside-c/package.json', localPackageJson('dsh-compat-c'))
      await symlink(outside, path.join(fx.overlayRoot, 'packages', 'q', 'vendor', 'c'), 'dir').catch(async () => {
        await fx.putOverlay('packages/q/vendor/.keep', '')
        await symlink(outside, path.join(fx.overlayRoot, 'packages', 'q', 'vendor', 'c'), 'dir')
      })
    }
    const before = await readFile(path.join(fx.profile, 'package.json'))
    const result = fx.sync()
    assert.notEqual(result.status, 0, `${variant}: ${result.stdout}`)
    assert.ok(result.stderr.includes(path.join(fx.overlayRoot, 'packages', 'q', 'vendor', 'c')), `${variant}: ${result.stderr}`)
    assert.deepEqual(await readFile(path.join(fx.profile, 'package.json')), before, variant)
    assert.equal(await fx.actionLog(), '', `${variant}: no DSH CLI call expected`)
  }
})

test('preflight failure on a fresh DSH_HOME leaves it empty', async (t) => {
  const fx = await overlayFixture({ initProfile: false })
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}`)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.deepEqual(await snapshotTree(fx.dshHome), {})
})

test('reset succeeds when the host runtime builder is missing', async (t) => {
  const petEntry = [
    '  - id: dsh-pet', '    type: package', '    source: local', '    version: 1.0.0', '    enabled: true',
    '    hostRuntimeCompatibility:', '      kind: pet-unified-locus-v1', '      supportedDshVersion: 0.1.0-rc.7', '',
  ].join('\n')
  const fx = await overlayFixture({ manifest: `${HEAD}dependencies:\n  - dsh-dep@1.0.0\ncustomizations:\n${petEntry}` })
  cleanup(t, fx)
  await fx.putPublic('packages/dsh-pet/package.json', localPackageJson('dsh-pet'))
  await fx.putPublic('packages/dsh-pet/index.js', 'export default 1\n')
  const builder = await fx.putPublic('packages/dsh-pet/compat/subagent/build-launcher.cjs', '')
  const first = fx.sync()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.ok((await fx.profilePkg()).dependencies['dsh-dep'])
  await rm(builder)

  // Normal sync: a missing builder is a source preflight failure — nothing changes.
  const before = await snapshotTree(fx.dshHome)
  const normal = fx.sync()
  assert.notEqual(normal.status, 0, normal.stdout)
  assert.ok(normal.stderr.includes(builder), normal.stderr)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)

  // Reset: undoing managed deployment must not depend on sources being present.
  const reset = fx.sync(['--reset'])
  assert.equal(reset.status, 0, reset.stdout + reset.stderr)
  const deps = (await fx.profilePkg()).dependencies
  assert.equal(deps['dsh-dep'], undefined)
  assert.equal(deps['dsh-pet'], undefined)
})

test('disabled local package without source is removed via the ledger', async (t) => {
  const fx = await overlayFixture()
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q')}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-private-q'))
  await fx.putOverlay('packages/q/index.js', 'export default 1\n')
  const first = fx.sync()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.ok((await fx.profilePkg()).dependencies['dsh-private-q'])

  await rm(path.join(fx.overlayRoot, 'packages', 'q'), { recursive: true })
  await fx.writeOverlay(`customizations:\n${localEntry('q', '', false)}`)
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal((await fx.profilePkg()).dependencies['dsh-private-q'], undefined)
})

test('disabled local package.json escaping its root is rejected before reading', async (t) => {
  const fx = await overlayFixture()
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q', '', false)}`)
  const outside = await fx.putPublic('../outside-q/package.json', localPackageJson('dsh-outside-q'))
  await fx.putOverlay('packages/q/.keep', '')
  await symlink(outside, path.join(fx.overlayRoot, 'packages', 'q', 'package.json'))
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /package q/)
  assert.match(result.stderr, /package\.json/)
  assert.match(result.stderr, /outside/)
  assert.ok(result.stderr.includes(fx.overlayRoot), result.stderr)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

test('reset succeeds when overlay sources are gone', async (t) => {
  const fx = await overlayFixture()
  cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q')}${patchEntry('p')}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-private-q'))
  await fx.putOverlay('packages/q/index.js', 'export default 1\n')
  await fx.putOverlay('patches/p.yml', '- insert: []\n')
  const first = fx.sync()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.match(await fx.readPatch(), /fragment: p/)

  await rm(path.join(fx.overlayRoot, 'packages', 'q'), { recursive: true })
  await rm(path.join(fx.overlayRoot, 'patches', 'p.yml'))
  const reset = fx.sync(['--reset'])
  assert.equal(reset.status, 0, reset.stdout + reset.stderr)
  assert.equal((await fx.profilePkg()).dependencies['dsh-private-q'], undefined)
  assert.doesNotMatch(await fx.readPatch(), /fragment: p/)
})
