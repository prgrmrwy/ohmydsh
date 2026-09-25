// Overlay root: an overlay file may live in a separate private repository that
// mirrors this one (packages/, skills/, presets/, patches/). Every local path of
// an overlay entry resolves against that root; public entries keep resolving
// against the public repo (spec: 本地 manifest overlay 追加不可公开定制).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { overlayFixture, snapshotTree, localPackageJson } from './helpers/overlay-fixture.mjs'

const VERSION_LINE = 'dshVersion: 0.1.0-rc.7\n'

function manifestWith(entries, { deps = [] } = {}) {
  const depBlock = deps.length === 0 ? 'dependencies: []\n' : `dependencies:\n${deps.map((d) => `  - ${d}`).join('\n')}\n`
  return `${VERSION_LINE}${depBlock}customizations:${entries.length === 0 ? ' []' : ''}\n${entries.join('')}`
}

const patchEntry = (id, extra = '') => `  - id: ${id}\n    type: patch\n    enabled: true\n${extra}`
const remoteEntry = (id, spec, extra = '') =>
  `  - id: ${id}\n    type: package\n    source: remote\n    spec: ${spec}\n    version: 1.0.0\n    enabled: true\n${extra}`

async function cleanup(t, fx) {
  t.after(() => rm(fx.root, { recursive: true, force: true }))
}

// ---------- load stage: reserved fields, env path, spec/name agreement ----------

test('reserved sourceRoot and overlaySource fields are rejected', async (t) => {
  for (const [where, field] of [['public', 'sourceRoot: /tmp/elsewhere'], ['overlay', 'overlaySource: x'], ['overlay', 'sourceRoot: /tmp/elsewhere']]) {
    const fx = await overlayFixture({
      manifest: where === 'public' ? manifestWith([patchEntry('p', `    ${field}\n`)]) : undefined,
    })
    await cleanup(t, fx)
    await fx.putPublic('patches/p.yml', '- insert: []\n')
    if (where === 'overlay') {
      await fx.writeOverlay(`customizations:\n${patchEntry('p', `    ${field}\n`)}`)
      await fx.putOverlay('patches/p.yml', '- insert: []\n')
    }
    const before = await snapshotTree(fx.dshHome)
    const result = fx.sync()
    assert.notEqual(result.status, 0, `${where} ${field}: ${result.stdout}`)
    assert.match(result.stderr, new RegExp(`${field.split(':')[0]}.*reserved|reserved.*${field.split(':')[0]}`), result.stderr)
    assert.deepEqual(await snapshotTree(fx.dshHome), before)
  }
})

test('relative DSH_LOCAL_MANIFEST is rejected by sync', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync([], { DSH_LOCAL_MANIFEST: 'private/dsh.yaml.local' })
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /DSH_LOCAL_MANIFEST/)
  assert.match(result.stderr, /absolute path/)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

test('relative DSH_LOCAL_MANIFEST degrades the startup listing with a warning', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith([remoteEntry('pub', 'dsh-pub@1.0.0', '    brief: public brief\n')]) })
  await cleanup(t, fx)
  const pkg = await fx.profilePkg()
  pkg.dsh.profile.bundles = ['dsh-pub']
  await fx.putPublic('../home/profiles/web/package.json', JSON.stringify(pkg))
  const result = fx.runScript('plugin-list.mjs', [], { DSH_LOCAL_MANIFEST: 'private/dsh.yaml.local' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /dsh-pub {2}\/\/ public brief/)
  assert.match(result.stderr, /DSH_LOCAL_MANIFEST/)
  assert.match(result.stderr, /绝对路径/)
})

test('name disagreeing with the npm spec is rejected', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${remoteEntry('b', 'dsh-example@1.0.0', '    name: other-name\n')}`)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  for (const needle of ['dsh-example', 'other-name', '\\(b\\)']) assert.match(result.stderr, new RegExp(needle))
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})


// ---------- owning root ----------

const skillEntry = (id) => `  - id: ${id}\n    type: skill\n    enabled: true\n`
const localEntry = (id, extra = '') => `  - id: ${id}\n    type: package\n    source: local\n    version: 1.0.0\n    enabled: true\n${extra}`

test('external overlay root materializes its own patch and skill', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}${skillEntry('s')}`)
  await fx.putOverlay('patches/p.yml', '- insert: [] # PRIVATE_PATCH\n')
  await fx.putOverlay('skills/s/SKILL.md', '# private skill\n')
  await fx.putOverlay('skills/s/extra.md', 'extra\n')
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: p/)
  assert.match(patch, /PRIVATE_PATCH/)
  assert.deepEqual(await snapshotTree(path.join(fx.dshHome, 'skills', 's')), await snapshotTree(path.join(fx.overlayRoot, 'skills', 's')))
})

test('repo-root overlay symlink resolves sources from the link target', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}`)
  await fx.putOverlay('patches/p.yml', '- insert: [] # FROM_TARGET\n')
  const { symlink } = await import('node:fs/promises')
  await symlink(fx.overlayFile, path.join(fx.repo, 'dsh.yaml.local'))
  const result = fx.sync([], { DSH_LOCAL_MANIFEST: '' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(await fx.readPatch(), /fragment: p[\s\S]*FROM_TARGET/)
})

test('public entry never takes source from the overlay root', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith([localEntry('shared')]) })
  await cleanup(t, fx)
  await fx.putPublic('packages/shared/package.json', localPackageJson('dsh-shared-public'))
  await fx.putPublic('packages/shared/index.js', 'export default "public"\n')
  await fx.putOverlay('packages/shared/package.json', localPackageJson('dsh-shared-private'))
  await fx.putOverlay('packages/shared/index.js', 'export default "private"\n')
  await fx.writeOverlay('customizations: []\n')
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const deps = (await fx.profilePkg()).dependencies
  assert.equal(deps['dsh-shared-public'], `file:${path.join(fx.repo, 'packages', 'shared')}`)
  assert.equal(deps['dsh-shared-private'], undefined)
})

test('public local package installs from the public packages dir', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith([localEntry('pub')]) })
  await cleanup(t, fx)
  await fx.putPublic('packages/pub/package.json', localPackageJson('dsh-pub-local'))
  await fx.putPublic('packages/pub/index.js', 'export default 1\n')
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal((await fx.profilePkg()).dependencies['dsh-pub-local'], `file:${path.join(fx.repo, 'packages', 'pub')}`)
})

// ---------- npm name uniqueness ----------
// Every name below shares the profile package.json `dependencies` key space, so
// an overlay entry reusing one would silently replace a public package's spec.

test('overlay package reusing a public npm name is rejected', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith([remoteEntry('a', 'dsh-shared-name@1.0.0')]) })
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${remoteEntry('b', 'dsh-shared-name@2.0.0', '    name: dsh-shared-name\n')}`)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  for (const needle of ['dsh-shared-name', '\\ba\\b', '\\bb\\b']) assert.match(result.stderr, new RegExp(needle))
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
  assert.equal(await fx.actionLog(), '')
})

test('overlay package reusing a top-level dependency name is rejected', async (t) => {
  const fx = await overlayFixture({ manifest: manifestWith([], { deps: ['dsh-dep-d@1.0.0'] }) })
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${remoteEntry('b', 'dsh-dep-d@2.0.0', '    name: dsh-dep-d\n')}`)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  for (const needle of ['dsh-dep-d', '\\bb\\b', 'dependencies']) assert.match(result.stderr, new RegExp(needle))
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
  assert.equal(await fx.actionLog(), '')
})

test('overlay package reusing a compat dependency name is rejected', async (t) => {
  const fx = await overlayFixture({
    manifest: manifestWith([localEntry('a', '    compatDependencies:\n      - name: dsh-compat-c\n        path: vendor/c\n')]),
  })
  await cleanup(t, fx)
  await fx.putPublic('packages/a/package.json', localPackageJson('dsh-a'))
  await fx.putPublic('packages/a/index.js', 'export default 1\n')
  await fx.putPublic('packages/a/vendor/c/package.json', localPackageJson('dsh-compat-c'))
  await fx.writeOverlay(`customizations:\n${remoteEntry('b', 'dsh-compat-c@2.0.0', '    name: dsh-compat-c\n')}`)
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  for (const needle of ['dsh-compat-c', '\\ba\\b', '\\bb\\b', 'compatDependencies']) assert.match(result.stderr, new RegExp(needle))
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
  assert.equal(await fx.actionLog(), '')
})

// ---------- local build in the owning root ----------

async function privateWorkspace(fx) {
  await fx.putOverlay('package.json', JSON.stringify({ name: 'fixture-private', private: true, workspaces: ['packages/*'] }, null, 2))
}

// The build writes where it ran (process.cwd()) and what it built, so the
// assertion is on the real working directory, not on a log line.
const BUILD_SCRIPT = "node -e \"const fs=require('fs');fs.mkdirSync('lib',{recursive:true});fs.writeFileSync('lib/index.js','export default 1');fs.writeFileSync('lib/cwd.txt',process.env.INIT_CWD)\""

test('external root local package builds in its own workspace', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await privateWorkspace(fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q')}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-private-q', { main: './lib/index.js', files: ['lib'], scripts: { build: BUILD_SCRIPT } }))
  await fx.putOverlay('packages/q/src/index.ts', 'export default 1\n')
  const publicBefore = await snapshotTree(fx.repo)
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  // npm sets INIT_CWD to the directory `npm run` was invoked from.
  assert.equal(await readFile(path.join(fx.overlayRoot, 'packages', 'q', 'lib', 'cwd.txt'), 'utf8'), fx.overlayRoot)
  assert.equal((await fx.profilePkg()).dependencies['dsh-private-q'], `file:${path.join(fx.overlayRoot, 'packages', 'q')}`)
  assert.deepEqual(await snapshotTree(fx.repo), publicBefore)
})

test('external root build failure stops before install', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await privateWorkspace(fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q')}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-private-q', { main: './lib/index.js', files: ['lib'], scripts: { build: 'exit 3' } }))
  await fx.putOverlay('packages/q/src/index.ts', 'export default 1\n')
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /dsh-private-q/)
  assert.match(result.stderr, /build/)
  assert.ok(result.stderr.includes(fx.overlayRoot), result.stderr)
  // No install or removal ran for q. (The pre-existing local-spec path repair
  // may still record the `file:` spec before the build, for public and overlay
  // packages alike; that is outside this scenario.)
  assert.doesNotMatch(await fx.actionLog(), /dsh-private-q|packages\/q/)
  assert.equal(existsSync(path.join(fx.profile, 'node_modules', 'dsh-private-q')), false)
})

test('buildInputs escaping the overlay root are rejected', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fx.writeOverlay(`customizations:\n${localEntry('q', '    buildInputs:\n      - ../outside.txt\n')}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-private-q'))
  await fx.putOverlay('packages/q/index.js', 'export default 1\n')
  await writeFile(path.join(fx.root, 'outside.txt'), 'x')
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, /buildInputs/)
  assert.match(result.stderr, /source root/)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

// ---------- public repo untouched, idempotence, startup listing ----------

async function fullPrivateSetup(fx) {
  await privateWorkspace(fx)
  await fx.writeOverlay(`customizations:\n${patchEntry('p')}${skillEntry('s')}${localEntry('q', '    brief: PRIVATE_BRIEF\n')}`)
  await fx.putOverlay('patches/p.yml', '- insert: [] # PRIVATE\n')
  await fx.putOverlay('skills/s/SKILL.md', '# s\n')
  await fx.putOverlay('packages/q/package.json', localPackageJson('@example/q', { description: 'package description' }))
  await fx.putOverlay('packages/q/index.js', 'export default 1\n')
}

test('syncing an external overlay leaves the public repo byte-identical', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fullPrivateSetup(fx)
  const before = await snapshotTree(fx.repo)
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(await snapshotTree(fx.repo), before)
  // Nothing sync writes may name the private root either.
  const patch = await fx.readPatch()
  assert.ok(!patch.includes(fx.overlayRoot), 'cordis.patch.yml must not reveal the overlay location')
  // …while still telling a reader that part of it did not come from dsh.yaml (D10).
  assert.match(patch.split('\n').slice(0, 3).join('\n'), /local manifest overlay/)
})

test('external overlay root sync is idempotent', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fullPrivateSetup(fx)
  const first = fx.sync()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  const home = await snapshotTree(fx.dshHome)
  const second = fx.sync()
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.deepEqual(await snapshotTree(fx.dshHome), home)
})

test('startup listing resolves local names from the overlay root', async (t) => {
  const fx = await overlayFixture()
  await cleanup(t, fx)
  await fullPrivateSetup(fx)
  assert.equal(fx.sync().status, 0)
  const pkg = await fx.profilePkg()
  pkg.dsh.profile.bundles = ['@example/q']
  await writeFile(path.join(fx.profile, 'package.json'), JSON.stringify(pkg))
  const result = fx.runScript('plugin-list.mjs')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /@example\/q {2}\/\/ PRIVATE_BRIEF/)
})
