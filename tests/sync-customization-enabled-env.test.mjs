import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_SCRIPT = path.join(REPO, 'scripts', 'sync.mjs')

/**
 * Fixture with a repo containing one or more `type: patch` customizations
 * (no package install involved, so no fake DSH_BIN behavior needed beyond a
 * harmless stub) — the simplest customization type to observe materialized
 * or not via the generated `cordis.patch.yml` fragment marker.
 */
async function fixture(items) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-enabled-env-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(path.join(repo, 'patches'), { recursive: true })
  await mkdir(path.join(dshHome, 'profiles', 'web'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(SYNC_SCRIPT))
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(
    path.join(dshHome, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2) + '\n',
  )

  const customLines = items.map((item) => {
    const lines = [
      `  - id: ${item.id}`,
      '    type: patch',
      `    enabled: ${JSON.stringify(item.enabled)}`,
    ]
    if (item.enabledEnv !== undefined) lines.push(`    enabledEnv: ${item.enabledEnv}`)
    return lines.join('\n')
  })
  await writeFile(
    path.join(repo, 'dsh.yaml'),
    `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n${customLines.join('\n')}\n`,
  )
  for (const item of items) {
    await writeFile(path.join(repo, 'patches', `${item.id}.yml`), '- insert: []\n')
  }

  const run = (extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_BIN: '/usr/bin/true', DSH_HOME: dshHome, ...extraEnv },
  })

  const patchPath = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  const readPatch = async () => (existsSync(patchPath) ? readFile(patchPath, 'utf8') : undefined)
  return { root, repo, dshHome, patchPath, run, readPatch }
}

test('enabledEnv truthy value enables a manifest-disabled customization', async () => {
  const fx = await fixture([{ id: 'demo-a', enabled: false, enabledEnv: 'DSH_DEMO_A' }])
  const result = fx.run({ DSH_DEMO_A: '1' })
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: demo-a/)
})

test('enabledEnv falsy value disables a manifest-enabled customization', async () => {
  const fx = await fixture([{ id: 'demo-b', enabled: true, enabledEnv: 'DSH_DEMO_B' }])
  const result = fx.run({ DSH_DEMO_B: '0' })
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.doesNotMatch(patch ?? '', /fragment: demo-b/)
})

test('unset enabledEnv falls back to the manifest enabled field (both directions)', async () => {
  const fxOn = await fixture([{ id: 'demo-c', enabled: true, enabledEnv: 'DSH_DEMO_C' }])
  const onResult = fxOn.run()
  assert.equal(onResult.status, 0, onResult.stderr)
  assert.match(await fxOn.readPatch(), /fragment: demo-c/)

  const fxOff = await fixture([{ id: 'demo-d', enabled: false, enabledEnv: 'DSH_DEMO_D' }])
  const offResult = fxOff.run()
  assert.equal(offResult.status, 0, offResult.stderr)
  assert.doesNotMatch((await fxOff.readPatch()) ?? '', /fragment: demo-d/)
})

test('blank or unrecognized enabledEnv value falls back to the manifest enabled field', async () => {
  const fx = await fixture([{ id: 'demo-e', enabled: true, enabledEnv: 'DSH_DEMO_E' }])
  for (const raw of ['', '   ', 'maybe']) {
    const result = fx.run({ DSH_DEMO_E: raw })
    assert.equal(result.status, 0, result.stderr)
    assert.match(await fx.readPatch(), /fragment: demo-e/)
  }
})

test('invalid enabledEnv name fails sync at manifest load, before any materialization', async () => {
  const fx = await fixture([{ id: 'demo-f', enabled: true, enabledEnv: 'traex_bridge' }])
  assert.equal(existsSync(fx.patchPath), false)
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /enabledEnv/)
  assert.match(result.stderr, /demo-f/)
  // Fail closed: no cordis.patch.yml (or any other materialization) was produced.
  assert.equal(existsSync(fx.patchPath), false)
})

test('enabledEnv override is idempotent across repeated runs', async () => {
  const fx = await fixture([{ id: 'demo-g', enabled: false, enabledEnv: 'DSH_DEMO_G' }])
  const first = fx.run({ DSH_DEMO_G: 'on' })
  assert.equal(first.status, 0, first.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: demo-g/)

  const second = fx.run({ DSH_DEMO_G: 'on' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.equal(await fx.readPatch(), patch)
})

test('a customization without enabledEnv ignores an unrelated same-shaped env var (no implicit convention)', async () => {
  // demo-h declares no enabledEnv at all; DSH_DEMO_H happening to be set must
  // not implicitly flip it — only an explicit `enabledEnv:` declaration reads
  // any environment variable for a given customization.
  const fx = await fixture([{ id: 'demo-h', enabled: false }])
  const result = fx.run({ DSH_DEMO_H: '1' })
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch((await fx.readPatch()) ?? '', /fragment: demo-h/)
})

test('two customizations with distinct enabledEnv vars are resolved independently', async () => {
  const fx = await fixture([
    { id: 'demo-i', enabled: false, enabledEnv: 'DSH_DEMO_I' },
    { id: 'demo-j', enabled: true, enabledEnv: 'DSH_DEMO_J' },
  ])
  const result = fx.run({ DSH_DEMO_I: '1', DSH_DEMO_J: '0' })
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: demo-i/)
  assert.doesNotMatch(patch, /fragment: demo-j/)
})
