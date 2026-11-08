// Official-runtime acceptance for the `fs-observation-policy` patch entry
// (change upgrade-dsh-0-2-2-runtime, D5 / specs/fs-observation-policy).
//
// 0.2.2 ships the read-before-edit policy row disabled. This repo re-enables it
// with a whole-row override patch (never a second package row). The assertion
// that matters is on the *effective* configuration, so this file runs the
// pinned official CLI's `--dump-config` against a profile that sync composed in
// an isolated DSH_HOME. It is NOT part of `npm test`; run it explicitly:
//
//   DSH_TEST_OFFICIAL_RUNTIME=/abs/dir/with/node_modules node --test tests/fs-observation-policy.official.mjs
//
// The directory must hold a complete install of @deepseek-ai/dsh at dshVersion.
// Never skip when the prerequisite is absent: report what is missing.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import yaml from 'js-yaml'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..')
const ID = 'fs-observation-policy'
const PACKAGE = '@deepseek-ai/dsh-fs-observation-policy'

const manifest = yaml.load(fs.readFileSync(path.join(root, 'dsh.yaml'), 'utf8'))
const dshVersion = manifest.dshVersion
assert.equal(typeof dshVersion, 'string', 'dsh.yaml must declare dshVersion')

const runtime = process.env.DSH_TEST_OFFICIAL_RUNTIME
assert(runtime && path.isAbsolute(runtime), 'DSH_TEST_OFFICIAL_RUNTIME must name an absolute directory holding a complete @deepseek-ai/dsh install')
const requireRuntime = createRequire(path.join(runtime, 'package.json'))
const cliDir = path.dirname(requireRuntime.resolve('@deepseek-ai/dsh/package.json'))
assert.equal(JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')).version, dshVersion, 'runtime @deepseek-ai/dsh version must equal dsh.yaml dshVersion')
const cliBin = path.join(cliDir, 'lib', 'bin.js')
assert(fs.existsSync(cliBin), `official CLI entry missing: ${cliBin}`)

const entry = (manifest.customizations ?? []).find((item) => item.id === ID)
const patchFile = path.join(root, 'patches', `${ID}.yml`)

// `!!js` rows are runtime expressions; keep them opaque so the dump parses.
const JS = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (data) => ({ js: data }) })
const SCHEMA = yaml.DEFAULT_SCHEMA.extend([JS])

function rowsNamed(node, name, out = []) {
  if (Array.isArray(node)) for (const item of node) rowsNamed(item, name, out)
  else if (node !== null && typeof node === 'object') {
    if (node.name === name) out.push(node)
    for (const value of Object.values(node)) rowsNamed(value, name, out)
  }
  return out
}

/** Sync (twice) a fixture that carries the REAL manifest entry + patch file with the given enabled flag. */
async function deploy(enabled) {
  assert(entry, `dsh.yaml has no customizations entry with id "${ID}"`)
  assert.equal(entry.type, 'patch', `${ID} must be a type: patch entry`)
  assert(fs.existsSync(patchFile), `missing ${path.relative(root, patchFile)}`)
  const body = yaml.dump({ dshVersion, dependencies: [], customizations: [{ id: ID, type: 'patch', enabled }] })
  const fx = await overlayFixture({ externalRoot: false, initProfile: false, manifest: body })
  await fx.putPublic(`patches/${ID}.yml`, fs.readFileSync(patchFile, 'utf8'))
  const env = { DSH_BIN: cliBin }
  const first = fx.sync([], env)
  assert.equal(first.status, 0, first.stderr + first.stdout)
  const second = fx.sync([], env)
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/, 'second sync must change nothing')
  return { fx, env }
}

function dumpConfig({ fx, env }) {
  const result = spawnSync(process.execPath, [cliBin, '--profile', 'web', '--dump-config'], {
    cwd: fx.repo, encoding: 'utf8', env: fx.env(env), maxBuffer: 64 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  return yaml.load(result.stdout, { schema: SCHEMA })
}

test('spec Scenario "启用后有效配置含策略行且未禁用"', async () => {
  const dep = await deploy(true)
  const rows = rowsNamed(dumpConfig(dep), PACKAGE)
  assert.equal(rows.length, 1, `effective config must hold exactly one ${PACKAGE} row, got ${rows.length}`)
  assert.equal(rows[0].id, ID)
  assert.notEqual(rows[0].disabled, true, 'policy row must not be disabled')
  assert.ok(rows[0].disabled === false || rows[0].disabled === undefined)
  assert.match(await dep.fx.readPatch(), new RegExp(`# --- fragment: ${ID} ---`))
})

test('spec Scenario "禁用后恢复官方默认"', async () => {
  const dep = await deploy(true)
  assert.equal(rowsNamed(dumpConfig(dep), PACKAGE)[0]?.disabled, false)
  // Flip the manifest entry off and rebuild in the same deployment.
  fs.writeFileSync(path.join(dep.fx.repo, 'dsh.yaml'), yaml.dump({ dshVersion, dependencies: [], customizations: [{ id: ID, type: 'patch', enabled: false }] }))
  const off = dep.fx.sync([], dep.env)
  assert.equal(off.status, 0, off.stderr)
  assert.doesNotMatch(await dep.fx.readPatch(), new RegExp(ID), 'profile patch must no longer carry the fragment')
  const rows = rowsNamed(dumpConfig(dep), PACKAGE)
  assert.equal(rows.length, 1, 'official row must remain exactly once')
  assert.equal(rows[0].id, ID)
  assert.equal(rows[0].disabled, true, 'official default (disabled) must be restored')
  const again = dep.fx.sync([], dep.env)
  assert.match(again.stdout, /no changes/)
})
