// sync-level checks for the `fs-observation-policy` patch entry (change
// upgrade-dsh-0-2-2-runtime, D5). These need no official runtime, so they run in
// `npm test`; the effective-config assertions (`--dump-config`) live in
// tests/fs-observation-policy.official.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const root = path.resolve(import.meta.dirname, '..')
const ID = 'fs-observation-policy'
const manifest = yaml.load(fs.readFileSync(path.join(root, 'dsh.yaml'), 'utf8'))
const entry = manifest.customizations.find((item) => item.id === ID)
const fragment = fs.readFileSync(path.join(root, 'patches', `${ID}.yml`), 'utf8')

test('manifest entry is an enabled type: patch with upgrade-review and removal notes', () => {
  assert.equal(entry?.type, 'patch')
  assert.equal(entry.enabled, true)
  assert.match(entry.note, /--dump-config/)
  assert.match(entry.note, /enabled:false → dsh build/)
})

test('fragment is a single whole-row override of the official row, never a second package row', () => {
  const rows = yaml.load(fragment)
  assert.deepEqual(rows, [{ id: ID, name: '@deepseek-ai/dsh-fs-observation-policy', disabled: false }])
})

test('sync renders the fragment into the profile patch, is idempotent, and removes it when disabled', async () => {
  const fx = await overlayFixture({
    externalRoot: false,
    manifest: yaml.dump({ dshVersion: manifest.dshVersion, dependencies: [], customizations: [{ id: ID, type: 'patch', enabled: true }] }),
  })
  await fx.putPublic(`patches/${ID}.yml`, fragment)
  assert.equal(fx.sync([]).status, 0)
  const rendered = await fx.readPatch()
  assert.match(rendered, new RegExp(`# --- fragment: ${ID} ---`))
  const packageRows = (yaml.load(rendered) ?? []).filter((row) => row?.name === '@deepseek-ai/dsh-fs-observation-policy')
  assert.equal(packageRows.length, 1, 'exactly one package row in the profile patch')
  assert.match(fx.sync([]).stdout, /no changes/)

  await fx.putPublic('dsh.yaml', yaml.dump({ dshVersion: manifest.dshVersion, dependencies: [], customizations: [{ id: ID, type: 'patch', enabled: false }] }))
  assert.equal(fx.sync([]).status, 0)
  assert.doesNotMatch(await fx.readPatch(), new RegExp(ID))
  assert.match(fx.sync([]).stdout, /no changes/)
})
