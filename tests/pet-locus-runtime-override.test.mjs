import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'

const ROOT = path.resolve(import.meta.dirname, '..')
const COMPAT = path.join(ROOT, 'packages', 'dsh-pet', 'compat', 'subagent')

async function text(name) {
  return readFile(path.join(COMPAT, name), 'utf8')
}

test('the runtime patch is pinned to the manifest DSH version', async () => {
  const manifest = yaml.load(await readFile(path.join(ROOT, 'dsh.yaml'), 'utf8'))
  const launcher = await text('build-launcher.cjs')
  const builder = await text('build.mjs')

  // A DSH version bump must force a deliberate re-audit instead of carrying a
  // source patch across an unknown upstream implementation. The patch was
  // re-derived against the target tag, so every provenance value must name
  // that exact target rather than the superseded 0.1.2 line.
  assert.equal(manifest.dshVersion, '0.1.5-rc.2')
  assert.match(launcher, /const version = '0\.1\.5-rc\.2'/)
  assert.match(builder, /tag: 'dsh-v0\.1\.5-rc\.2'/)
  assert.match(builder, /commit: 'fb2c4b9e698e30edb738bca4cf0618587db7d203'/)
  assert.doesNotMatch(launcher, /0\.1\.2-rc\.1/)
  assert.doesNotMatch(builder, /a66e4702047846cdaa10c66c9d3df3951f5ea70d/)
  assert.match(builder, /const run = \(command, args, cwd = here, options\)/)
  assert.match(builder, /pnpm@11\.7\.0', 'install', '--prefer-offline'\], checkout, \{ env: \{ CI: 'true' \} \}/)
  assert.match(builder, /reviewed DSH source requires Node \^22\.19\.0 or >=24\.0\.0/)
})

test('the recorded patch hash matches the reviewable patch on disk', async () => {
  const patch = await readFile(path.join(COMPAT, 'settlement-notice.patch'))
  const builder = await text('build.mjs')
  const actual = createHash('sha256').update(patch).digest('hex')

  assert.match(builder, new RegExp(`patchSha256:\\s*'${actual}'`))
})

test('storage is no longer patched: Pet registers its own backend instead', async () => {
  // Pet needs atomic multi-table commits and single-writer ownership of its
  // medium. Those used to be added by patching four upstream packages, which
  // kept `storage`, `storage-domain`, `storage-json` and `storage-sqlite`
  // inside the compatibility overlay and forced 32 hunks to be re-derived on
  // every DSH version bump.
  //
  // `@deepseek-ai/dsh-storage` exports the backend contract and its registry
  // for exactly this, so Pet implements `StorageBackend` itself
  // (`packages/dsh-pet/src/host/storage/`) and upstream stays untouched.
  // Re-introducing a storage patch requires fresh justification under
  // `pet-compat-minimization`, not a revert of this assertion.
  assert.equal(existsSync(path.join(COMPAT, 'storage-atomic.patch')), false)
  assert.equal(existsSync(path.join(COMPAT, 'build-storage.mjs')), false)

  const launcher = await text('build-launcher.cjs')
  assert.doesNotMatch(launcher, /storage-artifacts/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-storage[a-z-]*': `file:/)
})

test('the patch carries behavior, compatibility, and a runtime capability marker', async () => {
  const patch = await text('settlement-notice.patch')

  assert.match(patch, /settlementNotice/)
  assert.match(patch, /SUPPORTED_DESCRIPTOR_VERSIONS/)
  assert.match(patch, /supportsSettlementNotice/)
  assert.match(patch, /if \(activation\.settlementNotice === 'silent'\) return/)
})

test('the patch stays confined to one upstream package', async () => {
  // The isolated queued-turn claim was removed. It only ever served B035's
  // push-style inquiry dispatch, which the pull-style context tools
  // (`pet_locus_parent_lookup` and friends) superseded: those read an
  // already-persisted transcript without waking the target or taking its run
  // slot, so nothing needs to claim a turn. The seam never shipped — the
  // override stayed off behind an npm arborist crash, the ledger holds zero
  // inquiries — while costing two extra upstream packages (`core/agent`,
  // `core/agent-loop`) that had to be re-derived on every DSH version bump.
  //
  // Re-adding it requires fresh justification under `pet-compat-minimization`,
  // not a revert of this assertion.
  const patch = await text('settlement-notice.patch')

  const packages = new Set([...patch.matchAll(/^\+\+\+ b\/(\S+)/gm)]
    .map(([, file]) => file.match(/^packages\/([^/]+\/[^/]+)/)?.[1]))
  assert.deepEqual([...packages], ['subagent/subagent'])
  assert.doesNotMatch(patch, /isolateQueuedTurn/)
  assert.doesNotMatch(patch, /supportsIsolatedQueuedTurnClaim/)
})

test('the launcher installs reviewed overrides and atomically publishes a self-contained runtime', async () => {
  const launcher = await text('build-launcher.cjs')

  assert.match(launcher, /'@deepseek-ai\/dsh': version/)
  assert.match(launcher, /const npmVersion = '11\.19\.0'/)
  assert.match(launcher, /run\('corepack', \[`npm@\$\{npmVersion\}`/)
  assert.match(launcher, /'@deepseek-ai\/dsh-subagent': `file:\$\{join\(compatPackages, 'subagent'\)\}`/)
  // The framework version is declared, not left to npm's resolution order:
  // several official packages pin cordis EXACTLY while others allow a range,
  // so a newer release satisfying the range first leaves the tree invalid.
  // Derived from the reviewed upstream tree, never pasted.
  assert.match(launcher, /const frameworkPins = Object\.fromEntries\(/)
  assert.match(launcher, /'@deepseek-ai\/cordis', '@deepseek-ai\/cordis-plugin-include'/)
  assert.doesNotMatch(launcher, /const frameworkPins[^]*?'4\.0\.\d'/)
  // The dependency proof must cover EVERY overridden package. An override that
  // is staged but never proven present would leave Pet believing a seam exists
  // while running the unpatched registry build.
  assert.match(launcher, /runNpm\(\['ls', '@deepseek-ai\/dsh-subagent'\]/)
  // The agent pair is no longer overridden (see the patch-confinement test).
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-agent(-loop)?': `file:/)
  assert.doesNotMatch(launcher, /overrideRuntimeAgent/)
  assert.match(launcher, /renameSync\(staging, buildDir\)/)
  assert.match(launcher, /renameSync\(nextLink, launcher\)/)
  assert.match(launcher, /realpathSync\(here\)/)
  assert.match(launcher, /acquireCompatBuildLock/)
  assert.doesNotMatch(launcher, /node_modules\/\.npm\/_npx/)
})

test('generated runtime and launcher files remain out of version control', async () => {
  const ignore = await text('.gitignore')

  for (const entry of ['lib/', '.upstream/', '.launcher', '.launcher-builds/', 'package.json', 'agent-artifacts/']) {
    assert.match(ignore, new RegExp(`^${entry.replaceAll('.', '\\.').replace('/', '\\/')}$`, 'm'))
  }
})
