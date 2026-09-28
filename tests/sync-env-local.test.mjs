// Spec: manifest 消费脚本自行读取 .env.local 中决定部署内容的变量.
//
// A bare `node scripts/sync.mjs` used to ignore `.env.local` (only bin/dsh
// sources it), saw no overlay and uninstalled overlay packages with exit 0.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture, snapshotTree } from './helpers/overlay-fixture.mjs'
import { applyEnvLocal, enabledEnvNames, parseEnvLocal } from '../scripts/lib/env-local.mjs'

const patchEntry = (id, extra = '') => `  - id: ${id}\n    type: patch\n    enabled: true\n${extra}`

async function setup(t, { publicEntries = [], overlayEntries = [patchEntry('p')], envLocal } = {}) {
  const fx = await overlayFixture({
    manifest: `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:${publicEntries.length ? '\n' + publicEntries.join('') : ' []\n'}`,
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  for (const entry of publicEntries) await fx.putPublic(`patches/${/id: (\S+)/.exec(entry)[1]}.yml`, '- insert: []\n')
  await fx.writeOverlay(`customizations:\n${overlayEntries.join('')}`)
  for (const entry of overlayEntries) await fx.putOverlay(`patches/${/id: (\S+)/.exec(entry)[1]}.yml`, '- insert: []\n')
  if (envLocal !== undefined) await fx.putPublic('.env.local', envLocal(fx))
  // "Caller did not set it": spawn drops keys whose value is undefined.
  const bare = (extra = {}) => fx.sync([], { DSH_LOCAL_MANIFEST: undefined, ...extra })
  return { ...fx, bare }
}

test('bare sync picks DSH_LOCAL_MANIFEST up from .env.local, idempotently, without echoing it', async (t) => {
  const fx = await setup(t, { envLocal: (f) => `SSH_CONNECTION=1\nexport DSH_LOCAL_MANIFEST=${f.overlayFile}\n` })
  const first = fx.bare()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.match(await fx.readPatch(), /fragment: p/)
  assert.match(first.stdout, /DSH_LOCAL_MANIFEST from \.env\.local/)
  assert.ok(!first.stdout.includes(fx.overlayRoot), 'the overlay location must not be printed')
  const home = await snapshotTree(fx.dshHome)
  const second = fx.bare()
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /no changes/)
  assert.deepEqual(await snapshotTree(fx.dshHome), home)
})

test('a caller-set value (even empty) wins over .env.local', async (t) => {
  const fx = await setup(t, { envLocal: (f) => `DSH_LOCAL_MANIFEST=${f.overlayFile}\n` })
  const result = fx.sync([], { DSH_LOCAL_MANIFEST: '' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch((await fx.readPatch()) ?? '', /fragment: p/)
  assert.doesNotMatch(result.stdout, /from \.env\.local/)
})

test('enabledEnv switches in .env.local apply, for public and overlay entries alike', async (t) => {
  const fx = await setup(t, {
    publicEntries: [patchEntry('pub', '    enabledEnv: DSH_PUB_SWITCH\n').replace('enabled: true', 'enabled: false')],
    overlayEntries: [patchEntry('p', '    enabledEnv: DSH_OVL_SWITCH\n').replace('enabled: true', 'enabled: false')],
    envLocal: (f) => `DSH_LOCAL_MANIFEST='${f.overlayFile}'\nDSH_PUB_SWITCH=1\nexport DSH_OVL_SWITCH=on # inline comment\n`,
  })
  const result = fx.bare({ DSH_PUB_SWITCH: undefined, DSH_OVL_SWITCH: undefined })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: pub/)
  assert.match(patch, /fragment: p\b/)
})

test('variables outside the allow-list are not read', async (t) => {
  const elsewhere = path.join('/tmp', `ohmydsh-env-local-elsewhere-${process.pid}`)
  const fx = await setup(t, { envLocal: (f) => `DSH_HOME=${elsewhere}\nDSH_LOCAL_MANIFEST=${f.overlayFile}\n` })
  const result = fx.bare()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(existsSync(elsewhere), false)
  assert.match(await fx.readPatch(), /fragment: p/)
})

test('an allow-listed value needing shell expansion makes sync refuse without touching DSH_HOME', async (t) => {
  const fx = await setup(t, { envLocal: () => '# comment\nDSH_LOCAL_MANIFEST=$HOME/private/dsh.yaml\n' })
  const before = await snapshotTree(fx.dshHome)
  const result = fx.bare()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /\.env\.local:2: DSH_LOCAL_MANIFEST/)
  assert.ok(!result.stderr.includes('$HOME/private'), 'the raw value must not be echoed')
  assert.deepEqual(await snapshotTree(fx.dshHome), before)
})

test('the startup listing degrades on the same input', async (t) => {
  const fx = await setup(t, { envLocal: () => 'DSH_LOCAL_MANIFEST=`pwd`/dsh.yaml\n' })
  const result = fx.runScript('plugin-list.mjs', [], { DSH_LOCAL_MANIFEST: undefined })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /DSH_LOCAL_MANIFEST/)
})

test('shell syntax on lines outside the allow-list is ignored', async (t) => {
  const fx = await setup(t, {
    envLocal: (f) => `DSH_OPEN_APP="$HOME/Applications/X.app"\nif true; then :; fi\nDSH_LOCAL_MANIFEST='${f.overlayFile}'\n`,
  })
  const result = fx.bare()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(await fx.readPatch(), /fragment: p/)
})

// ---------- parser ----------

test('parser: literal forms', () => {
  const byName = Object.fromEntries(parseEnvLocal([
    'A=plain',
    'export B=/abs/path # trailing',
    "C='single $quoted'",
    'D="dq \\"esc\\" \\\\ x"',
    '  # indented comment',
    'E=',
    'F=a#b',
  ].join('\n')).map((e) => [e.name, e]))
  assert.equal(byName.A.value, 'plain')
  assert.equal(byName.B.value, '/abs/path')
  assert.equal(byName.C.value, 'single $quoted')
  assert.equal(byName.D.value, 'dq "esc" \\ x')
  assert.equal(byName.E.value, '')
  assert.equal(byName.F.value, 'a#b')
})

test('parser: non-literal forms are flagged, not guessed', () => {
  const problems = parseEnvLocal([
    'A=$HOME/x', 'B="${HOME}/x"', 'C=`pwd`', 'D=~/x', "E='open", 'F="open', 'G=a b', "H='a'b",
  ].join('\n'))
  for (const entry of problems) assert.ok(entry.problem, `${entry.name} should be flagged`)
  assert.equal(problems.length, 8)
})

test('applyEnvLocal: last assignment wins; caller wins; lenient mode reports', async (t) => {
  const fx = await overlayFixture()
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await fx.putPublic('.env.local', 'DSH_X=1\nDSH_X=2\nDSH_Y=$BAD\nDSH_Z=keep\n')
  const env = { DSH_Z: '' }
  const result = applyEnvLocal({ repo: fx.repo, names: ['DSH_X', 'DSH_Y', 'DSH_Z'], env, strict: false })
  assert.equal(env.DSH_X, '2')
  assert.equal(env.DSH_Y, undefined)
  assert.equal(env.DSH_Z, '')
  assert.deepEqual(result.applied, ['DSH_X'])
  assert.equal(result.errors.length, 1)
  assert.throws(() => applyEnvLocal({ repo: fx.repo, names: ['DSH_Y'], env: {}, strict: true }), /DSH_Y/)
})

test('enabledEnvNames collects declared names only', () => {
  assert.deepEqual(enabledEnvNames({ customizations: [{ enabledEnv: 'DSH_A' }, {}, null, { enabledEnv: 'DSH_A' }, { enabledEnv: 'DSH_B' }] }), ['DSH_A', 'DSH_B'])
  assert.deepEqual(enabledEnvNames({}), [])
})
