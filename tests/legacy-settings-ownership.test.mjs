import test from 'node:test'
import assert from 'node:assert/strict'
import * as YAML from 'yaml'
import { planSeedRows, reconcileOwnedKeys } from '../scripts/lib/legacy-settings.mjs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const row = (config, owner = 'org') => ({ id: 'dsh-memex', owner, config })
const config = (text) => YAML.parse(text).findLast(r => r.id === 'dsh-memex')?.config ?? {}
const run = (text, owned, ownership, seeds = []) => reconcileOwnedKeys({ text, owned, ownership, seeds, YAML })
const initial = '- id: dsh-memex\n  config:\n    scopes: [{ name: work }] # user\n'

const manifest = (enabled = true) => `dshVersion: 0.2.0-rc.2\ndependencies: []\ncustomizations:\n  - id: org\n    type: patch\n    enabled: ${enabled}\n    mergeConfig: true\n`
const fragment = (both = true) => '- id: dsh-memex\n  config:\n    internalHosts: [corp.example]\n' + (both ? '    internalDomains: [corp.example]\n' : '')

for (const mode of ['disable', 'drop-key', 'remove-fragment']) {
  test(`sync persists ownership and retires keys end-to-end: ${mode}`, async t => {
    const fx = await overlayFixture({ externalRoot: false, manifest: manifest() })
    t.after(() => rm(fx.root, { recursive: true, force: true }))
    await fx.putPublic('patches/org.yml', fragment())
    await writeFile(path.join(fx.profile, 'cordis.patch.yml'), initial)
    const before = fx.sync()
    assert.equal(before.status, 0, before.stderr)
    const statePath = path.join(fx.dshHome, '.dsh-sync-state.json')
    const ledger = JSON.parse(await readFile(statePath, 'utf8')).patchConfigOwnership
    assert.equal(ledger.version, 1)
    assert.equal(ledger.entries.length, 2)
    assert.deepEqual(ledger.entries[0].owners, ['org'])
    if (mode === 'drop-key') await fx.putPublic('patches/org.yml', fragment(false))
    else await fx.putPublic('dsh.yaml', mode === 'disable' ? manifest(false) : 'dshVersion: 0.2.0-rc.2\ndependencies: []\ncustomizations: []\n')
    const retired = fx.sync()
    assert.equal(retired.status, 0, retired.stderr)
    assert.deepEqual(config(await fx.readPatch()), mode === 'drop-key'
      ? { scopes: [{ name: 'work' }], internalHosts: ['corp.example'] }
      : { scopes: [{ name: 'work' }] })
    assert.match(await fx.readPatch(), /# user/)
    assert.equal(JSON.parse(await readFile(statePath, 'utf8')).patchConfigOwnership.entries.length, mode === 'drop-key' ? 1 : 0)
    const stable = fx.sync()
    assert.equal(stable.status, 0, stable.stderr)
    assert.match(stable.stdout, /no changes/)
  })
}

test('disabling a fragment retires only its introduced keys', () => {
  const enabled = run(initial, [row({ internalHosts: ['corp.example'] })])
  const disabled = run(enabled.text, [], enabled.ownership)
  assert.deepEqual(config(disabled.text), { scopes: [{ name: 'work' }] })
  assert.match(disabled.text, /# user/)
  assert.deepEqual(disabled.ownership.entries, [])
  assert.equal(run(disabled.text, [], disabled.ownership).text, disabled.text)
})

test('dropping one declared key retires it while other declared keys remain', () => {
  const enabled = run(initial, [row({ internalHosts: ['corp.example'], internalDomains: ['corp.example'] })])
  const narrowed = run(enabled.text, [row({ internalDomains: ['corp.example'] })], enabled.ownership)
  assert.deepEqual(config(narrowed.text), { scopes: [{ name: 'work' }], internalDomains: ['corp.example'] })
  assert.equal(narrowed.ownership.entries.length, 1)
})

test('retirement restores a previous user value after multiple owned updates', () => {
  const before = initial + '    internalHosts: [user.example]\n'
  const first = run(before, [row({ internalHosts: ['corp.example'] })])
  const second = run(first.text, [row({ internalHosts: ['new.example'] })], first.ownership)
  const disabled = run(second.text, [], second.ownership)
  assert.deepEqual(config(disabled.text).internalHosts, ['user.example'])
})

test('divergent user edits are preserved and reported, not deleted on retirement', () => {
  const enabled = run(initial, [row({ internalHosts: ['corp.example'] })])
  const edited = enabled.text.replace('corp.example', 'user.example')
  const retired = run(edited, [], enabled.ownership)
  assert.equal(retired.text, edited)
  assert.deepEqual(config(retired.text).internalHosts, ['user.example'])
  assert.match(retired.warnings.join('\n'), /dsh-memex\.internalHosts.*(changed|diverg)/)
  assert.equal(retired.ownership.entries.length, 1, 'retain unresolved ownership, never silently adopt drift')
})

test('shared keys use manifest order and retire only after the last owner leaves', () => {
  const both = run(initial, [row({ internalHosts: ['first.example'] }, 'first'), row({ internalHosts: ['last.example'] }, 'last')])
  assert.deepEqual(config(both.text).internalHosts, ['last.example'])
  assert.deepEqual(both.ownership.entries[0].owners, ['first', 'last'])
  const remaining = run(both.text, [row({ internalHosts: ['first.example'] }, 'first')], both.ownership)
  assert.deepEqual(config(remaining.text).internalHosts, ['first.example'])
  assert.equal(Object.hasOwn(config(run(remaining.text, [], remaining.ownership).text), 'internalHosts'), false)
})

test('sync records the legacy user baseline when an owned key overlaps its import', async t => {
  const fx = await overlayFixture({ externalRoot: false, manifest: manifest() })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await fx.putPublic('patches/org.yml', '- id: dsh-memex\n  config:\n    autoDerive: true\n')
  await writeFile(path.join(fx.dshHome, 'settings.yaml'), 'dsh-memex:\n  autoDerive: false\n')
  const enabled = fx.sync()
  assert.equal(enabled.status, 0, enabled.stderr)
  assert.equal(config(await fx.readPatch()).autoDerive, true)
  await fx.putPublic('dsh.yaml', manifest(false))
  const disabled = fx.sync()
  assert.equal(disabled.status, 0, disabled.stderr)
  assert.equal(config(await fx.readPatch()).autoDerive, false)
  assert.match(fx.sync().stdout, /no changes/)
})

test('legacy imported settings overlapping owned keys are restored on retirement', () => {
  const owned = [row({ autoDerive: true })]
  const plan = planSeedRows({ settingsText: 'dsh-memex:\n  autoDerive: false\n', runtimeRows: [], generatedConfig: () => owned[0].config })
  const active = reconcileOwnedKeys({ text: '[]\n', owned, seeds: plan.rows, seedBaselines: plan.baselines, YAML })
  const retired = run(active.text, [], active.ownership)
  assert.deepEqual(config(retired.text).autoDerive, false)
})

test('keys introduced by a new seed are owned with an absent baseline', () => {
  const seeded = run('[]\n', [row({ internalHosts: ['corp.example'] })], undefined, [{ id: 'dsh-memex', config: { internalHosts: ['corp.example'], scopes: [{ name: 'work' }] } }])
  const disabled = run(seeded.text, [], seeded.ownership)
  assert.deepEqual(config(disabled.text), { scopes: [{ name: 'work' }] })
})

test('untracked existing keys remain conservative baselines and re-enable is reversible', () => {
  const before = initial + '    internalHosts: [legacy.example]\n'
  const first = run(before, [row({ internalHosts: ['corp.example'] })])
  const disabled = run(first.text, [], first.ownership)
  assert.deepEqual(config(disabled.text).internalHosts, ['legacy.example'])
  const again = run(disabled.text, [row({ internalHosts: ['corp.example'] })], disabled.ownership)
  assert.deepEqual(config(run(again.text, [], again.ownership).text).internalHosts, ['legacy.example'])
})

test('an active user edit or removal becomes the baseline restored at retirement', () => {
  const enabled = run(initial + '    internalHosts: [old.example]\n', [row({ internalHosts: ['corp.example'] })])
  const edited = enabled.text.replace('corp.example', 'user.example')
  const maintained = run(edited, [row({ internalHosts: ['corp.example'] })], enabled.ownership)
  assert.deepEqual(config(run(maintained.text, [], maintained.ownership).text).internalHosts, ['user.example'])
  const doc = YAML.parseDocument(enabled.text)
  doc.deleteIn([0, 'config', 'internalHosts'])
  const reapplied = run(String(doc), [row({ internalHosts: ['corp.example'] })], enabled.ownership)
  assert.equal(Object.hasOwn(config(run(reapplied.text, [], reapplied.ownership).text), 'internalHosts'), false)
})

test('a previous expression is restored as !!js without evaluation', () => {
  const before = initial + '    internalHosts: !!js process.env.INTERNAL_HOSTS\n'
  const active = run(before, [row({ internalHosts: ['corp.example'] })])
  const retired = run(active.text, [], active.ownership)
  assert.match(retired.text, /internalHosts: !!js process\.env\.INTERNAL_HOSTS/)
})

test('malformed and unsupported ledgers refuse before changing anything', () => {
  for (const ownership of [{ version: 2, entries: [] }, { version: 1, entries: [{}] }]) {
    assert.throws(() => run(initial, [], ownership), /ownership ledger/)
  }
})

test('unchanged ownership and unrelated !!js/comments round-trip without rewrites', () => {
  const before = initial + '    expression: !!js process.env.HOME\n'
  const first = run(before, [row({ internalHosts: ['corp.example'] })])
  const second = run(first.text, [row({ internalHosts: ['corp.example'] })], first.ownership)
  assert.equal(second.text, first.text)
  assert.deepEqual(second.changed, [])
  assert.deepEqual(second.ownership, first.ownership)
  const disabled = run(second.text, [], second.ownership)
  assert.match(disabled.text, /expression: !!js process\.env\.HOME/)
  assert.match(disabled.text, /# user/)
})
