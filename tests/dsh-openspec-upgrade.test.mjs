import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = (name) => import(pathToFileURL(path.join(REPO, 'packages/dsh-openspec/lib', name)).href)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function setup(t) {
  const fx = await overlayFixture({
    externalRoot: false,
    manifest: `dshVersion: 0.1.5-rc.2\ncustomizations:\n  - id: dsh-openspec\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: true\n`,
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await cp(path.join(REPO, 'packages/dsh-openspec'), path.join(fx.repo, 'packages/dsh-openspec'), { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) })
  await writeFile(path.join(fx.repo, 'package.json'), await readFile(path.join(REPO, 'package.json')))
  await writeFile(path.join(fx.repo, 'package-lock.json'), await readFile(path.join(REPO, 'package-lock.json')))
  await mkdir(path.join(fx.repo, '.git'), { recursive: true }) // authoritative (non-worktree) checkout marker
  const first = fx.sync()
  assert.equal(first.status, 0, first.stderr)
  const stateDir = path.join(fx.dshHome, 'plugins/dsh-openspec')
  return { fx, stateDir, files: { pkg: path.join(fx.repo, 'packages/dsh-openspec/package.json'), lock: path.join(fx.repo, 'package-lock.json') } }
}

async function transaction(ctx, overrides = {}) {
  const { createUpgradeTransaction } = await lib('upgrade-transaction.js')
  const { activateGeneration } = await import(pathToFileURL(path.join(REPO, 'packages/dsh-openspec/lib/generations.js')).href)
  const stage = async (target) => {
    const lock = JSON.parse(await readFile(ctx.files.lock, 'utf8'))
    const pkg = JSON.parse(await readFile(ctx.files.pkg, 'utf8'))
    pkg.dependencies['@fission-ai/openspec'] = target
    lock.packages['packages/dsh-openspec'].dependencies['@fission-ai/openspec'] = target
    lock.packages['node_modules/@fission-ai/openspec'] = { ...lock.packages['node_modules/@fission-ai/openspec'], version: target, integrity: `sha512-${target}` }
    return { target, integrity: `sha512-${target}`, packageJson: pkg, lockfile: lock }
  }
  return createUpgradeTransaction({
    checkout: ctx.fx.repo, recordedCheckout: ctx.fx.repo, stateDir: ctx.stateDir, isWorktreeBound: false,
    stage, verify: async () => true,
    activate: async (target) => { await activateGeneration(ctx.fx.dshHome, target, { cli: true }); return { activation: 'live' } },
    runSync: async () => ctx.fx.sync().status === 0,
    ...overrides,
  })
}
const pin = async (ctx) => JSON.parse(await readFile(ctx.files.pkg, 'utf8')).dependencies['@fission-ai/openspec']

test('sync_records_authoritative_checkout_and_second_sync_is_noop', async (t) => {
  const ctx = await setup(t)
  const record = JSON.parse(await readFile(path.join(ctx.stateDir, 'source-checkout.json'), 'utf8'))
  assert.equal(record.checkout, ctx.fx.repo)
  const second = ctx.fx.sync()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
})

test('approved_upgrade_persists_across_sync_without_pin_mismatch_and_keeps_old_generation', async (t) => {
  const ctx = await setup(t)
  const txn = await transaction(ctx)
  const result = await txn.upgrade('1.13.3', { approved: true })
  assert.deepEqual({ status: result.status, activation: result.activation }, { status: 'ok', activation: 'live' })
  assert.equal(await pin(ctx), '1.13.3')
  const lock = JSON.parse(await readFile(ctx.files.lock, 'utf8'))
  assert.equal(lock.packages['node_modules/@fission-ai/openspec'].version, '1.13.3')
  const again = ctx.fx.sync()
  assert.equal(again.status, 0, again.stderr)
  assert.doesNotMatch(again.stderr, /dsh-openspec-pin-mismatch/)
  assert.equal(await pin(ctx), '1.13.3')
  const third = ctx.fx.sync()
  assert.match(third.stdout, /no changes/)
})

test('rollback_rewrites_source_and_survives_sync_without_mismatch', async (t) => {
  const ctx = await setup(t)
  const txn = await transaction(ctx)
  assert.equal((await txn.upgrade('1.13.3', { approved: true })).status, 'ok')
  assert.equal((await txn.rollback('1.13.2', { approved: true })).status, 'ok')
  assert.equal(await pin(ctx), '1.13.2')
  const sync = ctx.fx.sync()
  assert.equal(sync.status, 0, sync.stderr)
  assert.doesNotMatch(sync.stderr, /dsh-openspec-pin-mismatch/)
  assert.equal(await pin(ctx), '1.13.2')
})

test('blocked_or_failed_upgrade_keeps_hashes_and_active_id', async (t) => {
  const ctx = await setup(t)
  const before = { pkg: sha(await readFile(ctx.files.pkg)), lock: sha(await readFile(ctx.files.lock)) }
  const unchanged = async () => { assert.deepEqual({ pkg: sha(await readFile(ctx.files.pkg)), lock: sha(await readFile(ctx.files.lock)) }, before) }
  assert.equal((await (await transaction(ctx, { isWorktreeBound: true })).upgrade('1.13.3', { approved: true })).reason, 'worktree-bound')
  await unchanged()
  assert.equal((await (await transaction(ctx, { recordedCheckout: path.join(ctx.fx.root, "elsewhere") })).upgrade("1.13.3", { approved: true })).status, "blocked")
  await unchanged()
  assert.equal((await (await transaction(ctx)).upgrade('1.13.3', { approved: false })).reason, 'explicit-approval-required')
  assert.equal((await (await transaction(ctx)).upgrade('1.13.3-beta.1', { approved: true })).reason, 'invalid-stable-version')
  await unchanged()
  const mismatch = await (await transaction(ctx, { verify: async () => false })).upgrade('1.13.3', { approved: true })
  assert.equal(mismatch.status, 'failed')
  await unchanged()
  const drift = await (await transaction(ctx, { stage: async (target) => { await writeFile(ctx.files.lock, (await readFile(ctx.files.lock, 'utf8')).replace('"lockfileVersion"', '"lockfileVersion"')); const lock = JSON.parse(await readFile(ctx.files.lock, 'utf8')); lock.drift = true; await writeFile(ctx.files.lock, JSON.stringify(lock, null, 2)); return { target, integrity: `sha512-${target}`, packageJson: {}, lockfile: { packages: { 'packages/dsh-openspec': { dependencies: {} }, 'node_modules/@fission-ai/openspec': { version: target, integrity: `sha512-${target}` } } } } } })).upgrade('1.13.3', { approved: true })
  assert.equal(drift.reason, 'source-drift')
  assert.equal(await pin(ctx), '1.13.2')
})

test('kill_after_cas_reports_recovery_in_block_and_old_generation_serves', async (t) => {
  const ctx = await setup(t)
  const { activateGeneration } = await import(pathToFileURL(path.join(REPO, 'packages/dsh-openspec/lib/generations.js')).href)
  const { createGenerationBackedProvider } = await lib('generation-provider.js')
  const { managedInvocation } = await lib('managed-invocation.js')
  const invocation = managedInvocation({ node: '/usr/bin/node', cli: '/gen/old/bin/openspec.js', telemetry: 'adapter-off' })
  await activateGeneration(ctx.fx.dshHome, 'old', { version: '1.13.2', skills: [{ name: 's', body: 'old body' }], invocation })
  const crashed = await (await transaction(ctx, { crashAfterCas: true })).upgrade('1.13.3', { approved: true })
  assert.equal(crashed.status, 'recovery-required')
  // fresh process view: a new provider and new transaction against the same state
  const provider = createGenerationBackedProvider({ home: ctx.fx.dshHome, telemetry: 'adapter-off', updateCheck: 'disabled' })
  const served = await provider.get({ name: 's' })
  assert.match(served.content, /old body/)
  assert.match(served.content, /recovery=recovery-required/)
  assert.equal(await (await transaction(ctx)).inspectRecovery(), 'recovery-required')
  assert.equal((await (await transaction(ctx)).upgrade('1.13.4', { approved: true })).reason, 'recovery-required')
})

test('user_edit_after_cas_returns_recovery_required_untouched', async (t) => {
  const ctx = await setup(t)
  await (await transaction(ctx, { crashAfterCas: true })).upgrade('1.13.3', { approved: true })
  const pkg = JSON.parse(await readFile(ctx.files.pkg, 'utf8')); pkg.description = 'user edit'
  await writeFile(ctx.files.pkg, JSON.stringify(pkg, null, 2) + '\n')
  const before = { pkg: sha(await readFile(ctx.files.pkg)), lock: sha(await readFile(ctx.files.lock)), journal: sha(await readFile(path.join(ctx.stateDir, 'upgrade-journal.json'))) }
  const result = await (await transaction(ctx)).recoverRollback({ approved: true })
  assert.equal(result.status, 'recovery-required')
  assert.equal(result.reason, 'source-edited-after-cas')
  assert.deepEqual({ pkg: sha(await readFile(ctx.files.pkg)), lock: sha(await readFile(ctx.files.lock)), journal: sha(await readFile(path.join(ctx.stateDir, 'upgrade-journal.json'))) }, before)
})
