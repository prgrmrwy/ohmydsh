import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, readFile, writeFile, access, realpath, rm, symlink, readdir } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tsdownManifest = require.resolve('tsdown/package.json')
const tsdownBin = join(dirname(tsdownManifest), JSON.parse(await readFile(tsdownManifest, 'utf8')).bin.tsdown)

const source = fileURLToPath(new URL('../', import.meta.url))
const workspace = fileURLToPath(new URL('../../../', import.meta.url))
const parent = await realpath(tmpdir())
const manifestPath = join(source, 'package.json')
const prepared = await access(manifestPath).then(() => true, () => false)

test('bundle-source: build consumes current kernel source despite deliberately stale lib', async () => {
  assert.equal(prepared, true, 'consumer has no build contract or standalone artifact')
  const root = await mkdtemp(join(parent, 'dsh-collab-build-'))
  try {
    const pkg = join(root, 'packages', 'dsh-collab')
    const kernel = join(root, 'packages', 'collab-kernel')
    await mkdir(dirname(pkg), { recursive: true })
    await symlink(dirname(dirname(tsdownManifest)), join(root, 'node_modules'), 'dir')
    await cp(source, pkg, { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|lib|test)(?:\/|$)/.test(path.slice(source.length)) })
    await symlink(dirname(dirname(tsdownManifest)), join(pkg, 'node_modules'), 'dir')
    await cp(join(workspace, 'packages', 'collab-kernel', 'src'), join(kernel, 'src'), { recursive: true })
    await cp(join(workspace, 'packages', 'collab-kernel', 'package.json'), join(kernel, 'package.json'))
    await mkdir(join(kernel, 'lib'), { recursive: true })
    await writeFile(join(kernel, 'lib', 'index.js'), 'throw new Error("STALE_KERNEL_LIB")')
    const convention = join(kernel, 'src', 'convention', 'v4.md')
    await writeFile(convention, `${await readFile(convention, 'utf8')}\nCURRENT_SOURCE_SENTINEL\n`)
    const module = join(kernel, 'src', 'convention', 'index.ts')
    await writeFile(module, (await readFile(module, 'utf8')).replace("export const defaultConvention = conventions['4']!", "export const defaultConvention = { ...conventions['4']!, version: 'source-fixture' }"))
    const build = spawnSync(process.execPath, [tsdownBin, '--config', join(pkg, 'tsdown.config.ts')], { cwd: pkg, encoding: 'utf8' })
    assert.equal(build.status, 0, build.stderr + build.stdout)
    const detached = join(root, 'detached')
    await cp(join(pkg, 'lib'), detached, { recursive: true })
    await writeFile(join(detached, 'package.json'), '{"type":"module"}')
    const script = `const m=await import(${JSON.stringify(pathToFileURL(join(detached, 'index.js')).href)}); console.log(JSON.stringify(m.readBundledConvention()))`
    const loaded = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${detached}`, `--allow-fs-read=${join(root, 'node_modules')}`, `--allow-fs-read=${await realpath(dirname(dirname(tsdownManifest)))}`, '--input-type=module', '-e', script], { cwd: detached, encoding: 'utf8' })
    assert.equal(loaded.status, 0, loaded.stderr)
    const actual = JSON.parse(loaded.stdout)
    assert.equal(actual.version, 'source-fixture')
    assert.ok(actual.text.includes('CURRENT_SOURCE_SENTINEL'))
    assert.equal(await readFile(join(detached, 'v4.md'), 'utf8'), await readFile(convention, 'utf8'))
    for (const name of ['v1.md', 'v2.md', 'v3.md']) assert.equal(await readFile(join(detached, name), 'utf8'), await readFile(join(workspace, 'packages', 'collab-kernel', 'src', 'convention', name), 'utf8'))
    assert.ok(!(await readFile(join(detached, 'index.js'), 'utf8')).includes('STALE_KERNEL_LIB'))
    // Exercise the exact npm payload, not just a hand-copied lib directory.
    const packed = join(root, 'packed')
    await mkdir(packed)
    const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', packed], { cwd: pkg, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, npm_config_cache: join(root, 'npm-cache'), npm_config_userconfig: join(root, 'empty-npmrc') } })
    assert.equal(pack.status, 0, pack.stderr + pack.stdout)
    const packedResult = JSON.parse(pack.stdout)
    const payload = Array.isArray(packedResult) ? packedResult[0] : packedResult['dsh-collab']
    const names = payload.files.map(file => file.path)
    for (const required of ['lib/index.js', 'lib/index.d.ts', 'lib/v1.md', 'lib/v2.md', 'lib/v3.md', 'lib/v4.md', 'lib/salvage.mjs', 'cordis.patch.yml', 'LICENSE']) assert.ok(names.includes(required), required)
    assert.ok(!names.some(name => name.startsWith('src/') || name.startsWith('test/')))
    // data-dir-03：包不自带禁用行 — loading is decided only by the profile registering the bundle.
    assert.ok(!/disabled:\s*true/.test(await readFile(join(pkg, 'cordis.patch.yml'), 'utf8')), 'data-dir-03：包不自带禁用行')
    const unpack = spawnSync('tar', ['-xzf', join(packed, payload.filename), '-C', packed], { encoding: 'utf8' })
    assert.equal(unpack.status, 0, unpack.stderr)
    const unpacked = join(packed, 'package')
    const manifest = JSON.parse(await readFile(join(unpacked, 'package.json'), 'utf8'))
    assert.equal(manifest.dependencies?.['collab-kernel'], undefined)
    assert.equal(manifest.peerDependencies?.['collab-kernel'], undefined)
    const packedLoad = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${unpacked}`, `--allow-fs-read=${join(root, 'node_modules')}`, `--allow-fs-read=${await realpath(dirname(dirname(tsdownManifest)))}`, '--input-type=module', '-e', `const m=await import(${JSON.stringify(pathToFileURL(join(unpacked, 'lib/index.js')).href)}); console.log(JSON.stringify(m.readBundledConvention()))`], { cwd: unpacked, encoding: 'utf8' })
    assert.equal(packedLoad.status, 0, packedLoad.stderr)
    assert.deepEqual(JSON.parse(packedLoad.stdout), actual)
    assert.ok(!names.includes('lib/unlock.mjs'), 'unlock command removed')
    assert.equal(manifest.bin?.['dsh-collab-unlock'], undefined)
    assert.equal(manifest.bin?.['dsh-collab-salvage'], './lib/salvage.mjs')
    const cli = (args = []) => spawnSync(process.execPath, [join(unpacked, 'lib/salvage.mjs'), ...args], { cwd: unpacked, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root } })
    const help = cli(['--help'])
    assert.equal(help.status, 0, help.stderr)
    assert.ok(help.stdout.includes('--space-id'))
    const state = join(root, 'maintenance-state')
    await mkdir(state, { mode: 0o700 })
    const args = ['--data-dir', state, '--space-id', 's']
    // Build a real 3-record ledger, corrupt line 2, and salvage it with the packed bin.
    const { FileStore } = await import(pathToFileURL(join(workspace, 'packages/collab-kernel/lib/index.js')).href)
    const store = new FileStore(state)
    await store.open('s')
    for (let seq = 1; seq <= 3; seq++) await store.commit('s', { kind: 'completion', seq, events: [{ type: 'dispatch/completed', actor: 'system:dispatch', deliveryId: `d${seq}`, outcome: 'succeeded' }] }, seq - 1)
    await store.close('s')
    const original = (await readFile(join(state, 's.jsonl'), 'utf8')).split('\n')
    original[1] = 'corrupt'
    await writeFile(join(state, 's.jsonl'), original.join('\n'))
    const corrupted = await readFile(join(state, 's.jsonl'))
    await writeFile(join(state, 's.lock'), JSON.stringify({ instanceId: 'holder', pid: process.pid }))
    assert.notEqual(cli(args).status, 0, 'held space must be refused')
    assert.deepEqual(await readFile(join(state, 's.jsonl')), corrupted)
    await rm(join(state, 's.lock'))
    assert.notEqual(cli(args.slice(0, 2)).status, 0, 'space id required')
    const salvaged = cli(args)
    assert.equal(salvaged.status, 0, salvaged.stderr)
    assert.ok(salvaged.stdout.includes('保留 1') && salvaged.stdout.includes('第 2 行'), salvaged.stdout)
    await assert.rejects(readFile(join(state, 's.lock')), { code: 'ENOENT' })
    assert.equal((await readFile(join(state, 's.jsonl'), 'utf8')).trim().split('\n').length, 1)
    // A physically separate resource-less artifact must fail to load.
    const broken = join(root, 'broken')
    await mkdir(broken)
    await cp(join(detached, 'index.js'), join(broken, 'index.js'))
    await writeFile(join(broken, 'package.json'), '{"type":"module"}')
    const missing = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(broken, 'index.js')).href)})`], { cwd: broken, encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
    assert.ok(missing.stderr.includes('v1.md'), missing.stderr)
  } finally {
    const checked = await realpath(root)
    assert.equal(dirname(checked), parent)
    assert.ok(basename(checked).startsWith('dsh-collab-build-'))
    await rm(checked, { recursive: true })
  }
})
