import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { overlayFixture, snapshotTree } from '../../../tests/helpers/overlay-fixture.mjs'

const workspace = fileURLToPath(new URL('../../../', import.meta.url))
// The repository's fake installer copies bytes only. Real tsdown builds and
// Node imports below verify actual consumer artifacts, not installer behavior.
test('consumer-sync: current source changes deployed bytes and repeated sync is a no-op', async () => {
  const fx = await overlayFixture({ externalRoot: false, manifest: `dshVersion: 0.2.0-rc.2\ncustomizations:\n  - id: dsh-collab\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: true\n    buildInputs: [packages/collab-kernel/src, packages/collab-kernel/package.json, packages/dsh-collab/tsdown.config.ts]\n` })
  try {
    const pkg = join(fx.repo, 'packages/dsh-collab')
    await cp(join(workspace, 'packages/dsh-collab'), pkg, { recursive: true, filter: path => !/(?:^|\/)(?:lib|test|node_modules)(?:\/|$)/.test(path.slice(join(workspace, 'packages/dsh-collab').length)) })
    await cp(join(workspace, 'packages/collab-kernel/src'), join(fx.repo, 'packages/collab-kernel/src'), { recursive: true })
    await cp(join(workspace, 'packages/collab-kernel/package.json'), join(fx.repo, 'packages/collab-kernel/package.json'))
    // sync invokes the real workspace build via npm, but does not install deps.
    const env = { HOME: fx.root, DSH_TELEMETRY_DISABLED: '1' }
    const sync = () => { const result = fx.sync([], env); assert.equal(result.status, 0, result.stderr + result.stdout) }
    sync()
    const deployed = join(fx.profile, 'node_modules/dsh-collab/lib')
    const before = await readFile(join(deployed, 'index.js'))
    const snapshot = await snapshotTree(fx.dshHome)
    const actions = await fx.actionLog()
    sync()
    assert.deepEqual(await snapshotTree(fx.dshHome), snapshot)
    assert.equal(await fx.actionLog(), actions)
    const src = join(fx.repo, 'packages/collab-kernel/src/convention/index.ts')
    const md = join(fx.repo, 'packages/collab-kernel/src/convention/v3.md')
    await writeFile(src, (await readFile(src, 'utf8')).replace("export const defaultConvention = conventions['3']!", "export const defaultConvention = { ...conventions['3']!, version: 'sync-fixture' }"))
    await writeFile(md, `${await readFile(md, 'utf8')}\nSYNC_CURRENT_SOURCE\n`)
    sync()
    assert.notDeepEqual(await readFile(join(deployed, 'index.js')), before)
    assert.equal(await readFile(join(deployed, 'v3.md'), 'utf8'), await readFile(md, 'utf8'))
    for (const name of ['v1.md', 'v2.md']) assert.equal(await readFile(join(deployed, name), 'utf8'), await readFile(join(fx.repo, 'packages/collab-kernel/src/convention', name), 'utf8'))
    // Supply DSH peers explicitly from one graph, never kernel runtime.
    await mkdir(join(fx.profile, 'node_modules/@deepseek-ai'), { recursive: true })
    for (const name of ['schemastery', 'dsh-tools', 'dsh-llm', 'dsh-session']) await symlink(join(workspace, 'node_modules/@deepseek-ai', name), join(fx.profile, 'node_modules/@deepseek-ai', name), 'dir')
    const loaded = spawnSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(pathToFileURL(join(deployed, 'index.js')).href)});console.log(JSON.stringify(m.readBundledConvention()))`], { cwd: fx.root, encoding: 'utf8' })
    assert.equal(loaded.status, 0, loaded.stderr)
    const convention = JSON.parse(loaded.stdout)
    assert.equal(convention.version, 'sync-fixture'); assert.ok(convention.text.includes('SYNC_CURRENT_SOURCE'))
    const after = await snapshotTree(fx.dshHome), afterActions = await fx.actionLog()
    sync()
    assert.deepEqual(await snapshotTree(fx.dshHome), after)
    assert.equal(await fx.actionLog(), afterActions)
    const ledger = join(fx.dshHome, 'collaboration-data', 's.jsonl')
    await mkdir(dirname(ledger), { recursive: true })
    await writeFile(ledger, 'persistent-ledger-not-package-data\n')
    await fx.putPublic('dsh.yaml', (await readFile(join(fx.repo, 'dsh.yaml'), 'utf8')).replace('enabled: true', 'enabled: false'))
    sync()
    await assert.rejects(readFile(join(deployed, 'index.js')), { code: 'ENOENT' })
    assert.equal(await readFile(ledger, 'utf8'), 'persistent-ledger-not-package-data\n')
  } finally {
    const checked = await realpath(fx.root), parent = await realpath(tmpdir())
    assert.equal(dirname(checked), parent); assert.ok(basename(checked).startsWith('ohmydsh-ovr-'))
    await rm(checked, { recursive: true })
  }
})
