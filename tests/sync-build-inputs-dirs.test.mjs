import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { overlayFixture, snapshotTree, localPackageJson } from './helpers/overlay-fixture.mjs'

const SOURCE = 'packages/lib-x/src'
const INPUTS = [SOURCE, 'packages/lib-x/package.json']
const entry = (id, inputs) => `  - id: ${id}\n    type: package\n    source: local\n    version: 1.0.0\n    buildInputs: ${JSON.stringify(inputs)}\n`
const manifest = (entries) => `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n${entries}`
const statePath = (fx) => path.join(fx.dshHome, '.dsh-sync-state.json')
const state = async (fx) => JSON.parse(await readFile(statePath(fx), 'utf8'))
const hash = async (fx, name = 'dsh-a') => (await state(fx)).localPackageBuildInputs[name]
const syncOK = (fx) => {
  const result = fx.sync()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}

async function fixture(t, inputs = INPUTS, options = {}) {
  const fx = await overlayFixture({ manifest: manifest(entry('a', inputs)), ...options })
  // Verify the exact throwaway root before recursive removal; never remove a checkout.
  const temp = await realpath(os.tmpdir())
  assert.equal(path.dirname(fx.root), temp)
  assert.ok(path.basename(fx.root).startsWith('ohmydsh-ovr-'))
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await fx.putPublic('packages/a/package.json', localPackageJson('dsh-a'))
  await fx.putPublic('packages/a/index.js', 'export default 1\n')
  await fx.putPublic(`${SOURCE}/index.ts`, 'first\n')
  await fx.putPublic('packages/lib-x/package.json', '{"name":"lib-x","version":"1.0.0"}\n')
  fx.inputs = (values) => fx.putPublic('dsh.yaml', manifest(entry('a', values)))
  return fx
}

// Frozen pre-change algorithm. Deliberately not imported from production: this
// pins selection, Node salt, sorting, duplicate contributions and byte encoding.
async function oldFileHash(dir, inputs, root) {
  const walk = async (current, base = current) => {
    const out = []
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, e.name)
      const rel = path.relative(base, full)
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      if (e.isDirectory() && ['lib', 'node_modules', 'test', 'tests', 'checking', 'coverage'].includes(rel.split(path.sep).join('/'))) continue
      if (e.isFile() && ['package-lock.json', 'npm-debug.log'].includes(e.name)) continue
      if (e.isDirectory()) out.push(...await walk(full, base))
      else if (e.isFile()) out.push(rel)
    }
    return out
  }
  const selected = (await walk(dir)).filter((rel) => {
    const n = rel.split(path.sep).join('/')
    const b = path.posix.basename(n)
    return n.startsWith('src/') || n === 'package.json' || (!n.includes('/') && /\.mjs$/.test(n)) || /^tsconfig(?:\..+)?\.json$/.test(b) || /^(?:tsdown|vite|rollup|esbuild)\.config\.[cm]?[jt]s$/.test(b)
  })
  const h = createHash('sha256').update(`node:${process.version}\0`)
  for (const rel of selected.sort()) h.update(rel + '\0').update(await readFile(path.join(dir, rel)))
  for (const input of [...inputs].sort()) h.update(`repo:${input}\0`).update(await readFile(path.join(root, input)))
  return h.digest('hex')
}

// Explicit fixture oracle for the additive directory encoding, not a second
// collector implementation: each test supplies the exact expected file set.
async function expectedHash(fx, inputs, filesByDir) {
  const pkgDir = path.join(fx.repo, 'packages/a')
  const h = createHash('sha256').update(`node:${process.version}\0`)
  h.update('package.json\0').update(await readFile(path.join(pkgDir, 'package.json')))
  for (const input of [...inputs].sort()) {
    if (filesByDir[input] !== undefined) {
      h.update(`repo-dir:${input}\0`)
      for (const rel of [...filesByDir[input]].sort()) h.update(rel + '\0').update(await readFile(path.join(fx.repo, rel)))
    } else h.update(`repo:${input}\0`).update(await readFile(path.join(fx.repo, input)))
  }
  return h.digest('hex')
}

async function unchangedOnFailure(fx, pattern, absolute) {
  const before = await snapshotTree(fx.dshHome)
  const result = fx.sync()
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(result.stderr, pattern)
  assert.ok(result.stderr.includes(absolute), result.stderr)
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
  assert.equal(await fx.actionLog(), '')
}

async function buildFixture(t, inputs = INPUTS) {
  const fx = await fixture(t, inputs)
  await fx.putPublic('packages/a/package.json', localPackageJson('dsh-a', {
    main: './lib/index.js', files: ['lib'], scripts: { build: 'node build.mjs' },
  }))
  await fx.putPublic('packages/a/build.mjs', `import { mkdir, readFile, writeFile } from 'node:fs/promises'
const value = await readFile('../lib-x/src/index.ts', 'utf8')
await mkdir('lib', { recursive: true })
await writeFile('lib/index.js', 'export default ' + JSON.stringify(value) + '\\n')
`)
  fx.output = path.join(fx.repo, 'packages/a/lib/index.js')
  fx.deployed = path.join(fx.profile, 'node_modules/dsh-a/lib/index.js')
  return fx
}

test('overlay-regression-09: public manifest exposes no private fixture entries', async (t) => {
  const fx = await fixture(t, [])
  const id = 'private-fixture-only'
  const name = 'dsh-private-fixture-only'
  await fx.writeOverlay(`customizations:\n${entry(id, [])}`)
  await fx.putOverlay(`packages/${id}/package.json`, localPackageJson(name))
  await fx.putOverlay(`packages/${id}/index.js`, 'export default 1\n')
  const before = await readFile(path.join(fx.repo, 'dsh.yaml'))
  const clean = (bytes) => { assert.ok(!bytes.includes(id)); assert.ok(!bytes.includes(name)); assert.deepEqual(bytes, before) }
  assert.throws(() => clean(Buffer.concat([before, Buffer.from(`\n# ${id} ${name}`)])), assert.AssertionError)
  clean(before)
  syncOK(fx)
  clean(await readFile(path.join(fx.repo, 'dsh.yaml')))
  assert.equal((await fx.profilePkg()).dependencies[name], `file:${path.join(fx.overlayRoot, 'packages', id)}`)
})

test('overlay-regression-06: missing fields, remote identity and runtime mismatch fail before writes', async (t) => {
  for (const [body, pattern] of [
    ['  - id: no-version\n    type: package\n    source: local\n', /requires version/],
    ['  - id: bad-remote\n    type: package\n    source: remote\n    spec: not-an-npm-spec\n    version: 1.0.0\n', /requires an explicit name/],
    ['  - id: dsh-pet\n    type: package\n    source: local\n    version: 1.0.0\n    hostRuntimeCompatibility:\n      kind: pet-unified-locus-v1\n      supportedDshVersion: 9.9.9\n', /re-audit or remove/],
  ]) {
    const fx = await fixture(t, [], { initProfile: false })
    await fx.writeOverlay(`customizations:\n${body}`)
    await unchangedOnFailure(fx, pattern, body.includes('hostRuntimeCompatibility') ? 'dsh-pet hostRuntimeCompatibility' : fx.overlayFile)
  }
})

test('dir-input-06: 目录条目不存在时预检失败', async (t) => {
  for (const initProfile of [true, false]) {
    const fx = await fixture(t, ['packages/missing-dir'], { initProfile })
    await unchangedOnFailure(fx, /missing/, path.join(fx.repo, 'packages/missing-dir'))
  }
})

test('dir-boundary-input-kinds: file/dir accepted, FIFO/socket rejected, strict kinds retained', async (t) => {
  await t.test('dir-input-08: 原有文件条目仍通过预检', async (t) => {
    const fx = await fixture(t, ['packages/lib-x/package.json'])
    syncOK(fx)
    assert.equal(await hash(fx), await oldFileHash(path.join(fx.repo, 'packages/a'), ['packages/lib-x/package.json'], fx.repo))
  })
  await t.test('directory accepted', async (t) => { syncOK(await fixture(t)) })
  for (const kind of ['fifo', 'socket']) await t.test(`dir-input-07: ${kind} fails before writes`, async (t) => {
    const fx = await fixture(t, ['special'], { initProfile: false })
    const target = path.join(fx.repo, 'special')
    if (kind === 'fifo') {
      const result = spawnSync('mkfifo', [target], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    } else {
      const server = net.createServer()
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(target, resolve) })
      t.after(() => new Promise((resolve) => server.close(resolve)))
    }
    await unchangedOnFailure(fx, /regular file or directory/, target)
  })
  for (const kind of ['file', 'dir']) await t.test(`strict ${kind} rejects wrong type`, async (t) => {
    const fx = await fixture(t, [])
    let target
    if (kind === 'file') {
      await fx.putPublic('dsh.yaml', 'dshVersion: 0.1.0-rc.7\ncustomizations:\n  - id: p\n    type: patch\n')
      target = path.join(fx.repo, 'patches/p.yml')
      await mkdir(target, { recursive: true })
    } else {
      await fx.putPublic('dsh.yaml', 'dshVersion: 0.1.0-rc.7\ncustomizations:\n  - id: s\n    type: skill\n')
      target = await fx.putPublic('skills/s', 'not a directory')
    }
    await unchangedOnFailure(fx, kind === 'file' ? /must be a regular file/ : /must be a directory/, target)
  })
})

test('dir-input-02: 目录内新增、删除或改名文件改变哈希', async (t) => {
  const fx = await fixture(t)
  syncOK(fx)
  let previous = await hash(fx)
  for (const mutate of [
    () => fx.putPublic(`${SOURCE}/extra.ts`, 'extra'),
    () => rm(path.join(fx.repo, SOURCE, 'extra.ts')),
    () => rename(path.join(fx.repo, SOURCE, 'index.ts'), path.join(fx.repo, SOURCE, 'main.ts')),
  ]) {
    await mutate()
    syncOK(fx)
    const current = await hash(fx)
    assert.notEqual(current, previous)
    previous = current
  }
})

test('dir-input-04: 空目录条目的哈希稳定且不同于无条目', async (t) => {
  const fx = await fixture(t, ['packages/empty'])
  await mkdir(path.join(fx.repo, 'packages/empty'))
  syncOK(fx)
  const empty = await hash(fx)
  assert.equal(empty, await expectedHash(fx, ['packages/empty'], { 'packages/empty': [] }))
  syncOK(fx)
  assert.equal(await hash(fx), empty)
  await fx.inputs([])
  syncOK(fx)
  assert.notEqual(await hash(fx), empty)
})

test('dir-boundary-overlap: dir-input-05 ordering, duplicates, file+dir and self overlap keep contributions', async (t) => {
  const values = [SOURCE, `${SOURCE}/index.ts`, SOURCE, 'packages/a']
  const fx = await fixture(t, values)
  await fx.putPublic(`${SOURCE}/z.ts`, 'z')
  await fx.putPublic(`${SOURCE}/nested/a.ts`, 'nested')
  await fx.putPublic(`${SOURCE}/a.ts`, 'a')
  const files = { [SOURCE]: [`${SOURCE}/z.ts`, `${SOURCE}/nested/a.ts`, `${SOURCE}/index.ts`, `${SOURCE}/a.ts`], 'packages/a': ['packages/a/index.js', 'packages/a/package.json'] }
  syncOK(fx)
  const first = await hash(fx)
  assert.equal(first, await expectedHash(fx, values, files))
  await fx.inputs([...values].reverse())
  syncOK(fx)
  assert.equal(await hash(fx), first)
  await fx.inputs(values.slice(1))
  syncOK(fx)
  assert.notEqual(await hash(fx), first, 'duplicate directory must contribute again')
  for (const explicit of [`${SOURCE}/.hidden`, 'packages/lib-x/test/helper.ts']) {
    await fx.putPublic(explicit, 'one')
    await fx.inputs([SOURCE, explicit])
    syncOK(fx)
    const before = await hash(fx)
    await fx.putPublic(explicit, 'two')
    syncOK(fx)
    assert.notEqual(await hash(fx), before, 'explicit file still counts outside/default-skipped range')
  }
})

test('dir-boundary-filters: dir-input-03 ignored scope; dir-input-12 nested lib/test are source', async (t) => {
  const fx = await buildFixture(t)
  syncOK(fx)
  const before = await hash(fx)
  const home = await snapshotTree(fx.dshHome)
  for (const rel of ['packages/lib-x/test/x.test.ts', 'packages/lib-x/lib/index.js', `${SOURCE}/.cache/x`, `${SOURCE}/node_modules/x.js`, `${SOURCE}/.hidden`]) await fx.putPublic(rel, 'ignored')
  const outside = await fx.putPublic('../outside-source.ts', 'ignored link target')
  await symlink(outside, path.join(fx.repo, SOURCE, 'external-link.ts'))
  const run = syncOK(fx)
  assert.equal(await hash(fx), before)
  assert.doesNotMatch(run.stdout, /build local package/)
  assert.match(run.stdout, /no changes/)
  assert.deepEqual(await snapshotTree(fx.dshHome), home)
  for (const rel of [`${SOURCE}/lib/core.ts`, `${SOURCE}/test/helper.ts`]) {
    await fx.putPublic(rel, 'one')
    syncOK(fx)
    const old = await hash(fx)
    await fx.putPublic(rel, 'two')
    syncOK(fx)
    assert.notEqual(await hash(fx), old)
  }
})

test('dir-boundary-links: internal file/dir links ignored; top-level in-root accepted, dir-input-09 escape rejected', async (t) => {
  const fx = await fixture(t)
  syncOK(fx)
  const before = await hash(fx)
  await fx.putPublic('targets/file', 'inside')
  await fx.putPublic('../outside/file', 'outside')
  for (const [name, target] of [['inside-file', path.join(fx.repo, 'targets/file')], ['outside-file', path.join(fx.root, 'outside/file')], ['inside-dir', path.join(fx.repo, 'targets')], ['outside-dir', path.join(fx.root, 'outside')]]) {
    await symlink(target, path.join(fx.repo, SOURCE, name))
  }
  syncOK(fx)
  assert.equal(await hash(fx), before)
  await fx.putPublic('targets/file', 'inside changed')
  await fx.putPublic('../outside/file', 'outside changed')
  syncOK(fx)
  assert.equal(await hash(fx), before)
  await symlink(path.join(fx.repo, SOURCE), path.join(fx.repo, 'source-link'), 'dir')
  await fx.inputs(['source-link'])
  syncOK(fx)
  assert.equal(await hash(fx), await expectedHash(fx, ['source-link'], { 'source-link': ['source-link/index.ts'] }))
  const rejected = await fixture(t, ['escape'])
  await symlink(fx.root, path.join(rejected.repo, 'escape'), 'dir')
  await unchangedOnFailure(rejected, /outside its source root/, path.join(rejected.repo, 'escape'))
})

test('dir-boundary-root-isolation: dir-input-10 public and overlay use only their owning root', async (t) => {
  const fx = await fixture(t)
  await fx.writeOverlay(`customizations:\n${entry('q', INPUTS)}`)
  await fx.putOverlay('packages/q/package.json', localPackageJson('dsh-q'))
  await fx.putOverlay('packages/q/index.js', 'export default 1\n')
  for (const rel of INPUTS.slice(1)) await fx.putOverlay(rel, '{}\n')
  await fx.putOverlay(`${SOURCE}/index.ts`, 'private')
  syncOK(fx)
  const publicHash = await hash(fx)
  const privateHash = await hash(fx, 'dsh-q')
  await fx.putPublic(`${SOURCE}/index.ts`, 'public changed')
  syncOK(fx)
  assert.notEqual(await hash(fx), publicHash)
  assert.equal(await hash(fx, 'dsh-q'), privateHash)
  const changedPublic = await hash(fx)
  await fx.putOverlay(`${SOURCE}/index.ts`, 'private changed')
  syncOK(fx)
  assert.equal(await hash(fx), changedPublic)
  assert.notEqual(await hash(fx, 'dsh-q'), privateHash)
})

test('dir-input-11: 既有文件条目的哈希保持不变', async (t) => {
  const values = ['packages/lib-x/package.json', `${SOURCE}/index.ts`, `${SOURCE}/index.ts`, 'packages/a/src/own.ts']
  const fx = await fixture(t, values)
  for (const [rel, bytes] of [['src/own.ts', 'own'], ['src/lib/core.ts', 'nested'], ['lib/excluded.js', 'excluded'], ['test/excluded.ts', 'excluded'], ['build.mjs', '// build'], ['tsconfig.json', '{}'], ['nested/tsconfig.client.json', '{}']]) await fx.putPublic(`packages/a/${rel}`, bytes)
  syncOK(fx)
  assert.equal(await hash(fx), await oldFileHash(path.join(fx.repo, 'packages/a'), values, fx.repo))
})

test('dir-input-01: 外部源码变化构建并上线新字节，mtime 无关且第二次幂等', async (t) => {
  const fx = await buildFixture(t)
  syncOK(fx)
  const first = await hash(fx)
  assert.match(await readFile(fx.deployed, 'utf8'), /first/)
  const input = path.join(fx.repo, SOURCE, 'index.ts')
  const times = await stat(input)
  await utimes(input, times.atime, new Date(times.mtimeMs + 60_000))
  const touched = syncOK(fx)
  assert.equal(await hash(fx), first)
  assert.doesNotMatch(touched.stdout, /build local package/)
  await writeFile(input, 'second\n')
  await utimes(input, times.atime, times.mtime)
  const run = syncOK(fx)
  assert.match(run.stdout, /build local package dsh-a/)
  assert.notEqual(await hash(fx), first)
  assert.match(await readFile(fx.deployed, 'utf8'), /second/)
  assert.deepEqual(await readFile(fx.deployed), await readFile(fx.output))
  const home = await snapshotTree(fx.dshHome)
  const second = syncOK(fx)
  assert.match(second.stdout, /no changes/)
  assert.doesNotMatch(second.stdout, /build local package/)
  assert.deepEqual(await snapshotTree(fx.dshHome), home)
})

test('dir-boundary-freshness: own lib drift and absent output record independently rebuild', async (t) => {
  const fx = await buildFixture(t, [SOURCE, 'packages/a'])
  syncOK(fx)
  // Own-directory input includes lib: settle the post-build hash before drift.
  syncOK(fx)
  syncOK(fx)
  await writeFile(fx.output, 'export default "STALE"\n')
  const drift = syncOK(fx)
  assert.match(drift.stdout, /build local package dsh-a/)
  assert.match(await readFile(fx.deployed, 'utf8'), /first/)
  syncOK(fx)
  const settled = await hash(fx)
  const ledger = await state(fx)
  for (const key of Object.keys(ledger)) if (key.startsWith('localPackage') && !['localPackageBuildInputs', 'localPackageHashes'].includes(key)) delete ledger[key]
  await writeFile(statePath(fx), JSON.stringify(ledger))
  const missing = syncOK(fx)
  assert.equal(await hash(fx), settled, 'unchanged inputs do not waive missing generation evidence')
  assert.match(missing.stdout, /build local package dsh-a/)
  assert.match(await readFile(fx.deployed, 'utf8'), /first/)
})
