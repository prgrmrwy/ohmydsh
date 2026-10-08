import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import * as YAML from 'yaml'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const manifest = enabled => `dshVersion: 0.2.0-rc.2\ndependencies: []\ncustomizations:\n  - id: org\n    type: patch\n    enabled: ${enabled}\n    mergeConfig: true\n`
const initial = '- id: dsh-memex\n  config:\n    scopes: [{ name: work }]\n    internalHosts: [user.example]\n'
const patchOf = fx => path.join(fx.profile, 'cordis.patch.yml')
const stateOf = fx => path.join(fx.dshHome, '.dsh-sync-state.json')
const transactionOf = fx => path.join(fx.profile, '.ohmydsh-patch-transaction.json')
const conf = text => YAML.parse(text).findLast(row => row.id === 'dsh-memex')?.config
async function fixture(t) {
  const fx = await overlayFixture({ externalRoot: false, manifest: manifest(true) })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await fx.putPublic('patches/org.yml', '- id: dsh-memex\n  config:\n    internalHosts: [corp.example]\n')
  await writeFile(patchOf(fx), initial, { mode: 0o600 })
  return fx
}
async function completed(fx) {
  const result = fx.sync()
  assert.equal(result.status, 0, result.stderr)
  return { text: await fx.readPatch(), state: JSON.parse(await readFile(stateOf(fx), 'utf8')) }
}
async function journal(fx, before, after, ownership) {
  const record = { version: 1, beforeHash: hash(before), afterHash: hash(after), ownership }
  await writeFile(transactionOf(fx), JSON.stringify(record), { mode: 0o600 })
  return record
}

test('recover crash after patch publication before ledger save before retiring disabled fragment', async t => {
  const fx = await fixture(t)
  const saved = await completed(fx)
  const stale = { ...saved.state }
  delete stale.patchConfigOwnership
  await writeFile(stateOf(fx), JSON.stringify(stale))
  await journal(fx, initial, saved.text, saved.state.patchConfigOwnership)
  await fx.putPublic('dsh.yaml', manifest(false))
  const recovered = fx.sync()
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.deepEqual(conf(await fx.readPatch()).internalHosts, ['user.example'], 'must recover real baseline, not adopt published owned value')
  assert.equal(existsSync(transactionOf(fx)), false)
  assert.deepEqual(JSON.parse(await readFile(stateOf(fx), 'utf8')).patchConfigOwnership.entries, [])
  assert.match(fx.sync().stdout, /no changes/)
})

test('a journal left before patch publication is discarded without committing its ledger', async t => {
  const fx = await fixture(t)
  const saved = await completed(fx)
  await journal(fx, saved.text, 'never-published', { version: 1, entries: [] })
  const result = fx.sync()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(await fx.readPatch(), saved.text)
  assert.deepEqual(JSON.parse(await readFile(stateOf(fx), 'utf8')).patchConfigOwnership, saved.state.patchConfigOwnership)
  assert.equal(existsSync(transactionOf(fx)), false)
})

for (const kind of ['invalid-json', 'unknown-version', 'unknown-current', 'malformed-ownership']) {
  test(`pending journal refuses ${kind} and preserves patch, backup, ledger and journal`, async t => {
    const fx = await fixture(t)
    const saved = await completed(fx)
    const backup = await readFile(patchOf(fx) + '.bak', 'utf8')
    const state = await readFile(stateOf(fx), 'utf8')
    const record = { version: 1, beforeHash: hash(initial), afterHash: hash(saved.text), ownership: saved.state.patchConfigOwnership }
    if (kind === 'unknown-version') record.version = 9
    if (kind === 'unknown-current') record.afterHash = hash('unknown')
    if (kind === 'malformed-ownership') record.ownership = { version: 1, entries: [{}] }
    const raw = kind === 'invalid-json' ? '{broken' : JSON.stringify(record)
    await writeFile(transactionOf(fx), raw, { mode: 0o600 })
    const result = fx.sync()
    assert.notEqual(result.status, 0)
    assert.equal(await fx.readPatch(), saved.text)
    assert.equal(await readFile(patchOf(fx) + '.bak', 'utf8'), backup)
    assert.equal(await readFile(stateOf(fx), 'utf8'), state)
    assert.equal(await readFile(transactionOf(fx), 'utf8'), raw)
    assert.equal((await stat(transactionOf(fx))).mode & 0o777, 0o600)
  })
}

test('malformed existing sync state refuses without patch or backup writes', async t => {
  const fx = await fixture(t)
  const saved = await completed(fx)
  const backup = await readFile(patchOf(fx) + '.bak', 'utf8')
  await writeFile(stateOf(fx), '{broken')
  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.equal(await fx.readPatch(), saved.text)
  assert.equal(await readFile(patchOf(fx) + '.bak', 'utf8'), backup)
  assert.equal(await readFile(stateOf(fx), 'utf8'), '{broken')
})

test('patch and backup replacements retain owner-only mode', async t => {
  const fx = await fixture(t)
  await completed(fx)
  assert.equal((await stat(patchOf(fx))).mode & 0o777, 0o600)
  assert.equal((await stat(patchOf(fx) + '.bak')).mode & 0o777, 0o600)
  assert.equal((await stat(stateOf(fx))).mode & 0o777, 0o600)
})

test('actual journal is owner-only and recoverable after an ordinary publication exception', async t => {
  const fx = await fixture(t)
  // Fail rename only at patch publication in a child, without product test hooks.
  const code = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const rename=fs.promises.rename; fs.promises.rename=async (from,to)=>{if(to===${JSON.stringify(patchOf(fx))}) throw new Error('injected patch publication failure'); return rename(from,to)};
    syncBuiltinESMExports(); await import(${JSON.stringify(pathToFileURL(path.join(fx.repo, 'scripts/sync.mjs')).href)});`
  const failed = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: fx.repo, env: fx.env(), encoding: 'utf8' })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /injected patch publication failure/)
  assert.equal(await fx.readPatch(), initial)
  const tx = JSON.parse(await readFile(transactionOf(fx), 'utf8'))
  assert.equal(tx.beforeHash, hash(initial))
  assert.equal((await stat(transactionOf(fx))).mode & 0o777, 0o600)
  const recovered = fx.sync()
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.equal(existsSync(transactionOf(fx)), false)
  assert.deepEqual(conf(await fx.readPatch()).internalHosts, ['corp.example'])
})
