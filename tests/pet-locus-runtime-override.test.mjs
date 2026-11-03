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
  // that exact target rather than a superseded line (0.1.2, then 0.1.5).
  assert.equal(manifest.dshVersion, '0.2.0-rc.2')
  assert.match(launcher, /const version = '0\.2\.0-rc\.2'/)
  assert.match(builder, /tag: 'dsh-v0\.2\.0-rc\.2'/)
  assert.match(builder, /commit: '639ed015397290b3745d163aafe02ffee4aa3f84'/)
  for (const stale of [/0\.1\.2-rc\.1/, /0\.1\.5-rc\.2/, /a66e4702047846cdaa10c66c9d3df3951f5ea70d/, /fb2c4b9e698e30edb738bca4cf0618587db7d203/]) {
    assert.doesNotMatch(launcher, stale)
    assert.doesNotMatch(builder, stale)
  }
  // The Host only takes the compatibility runtime when the declaration names the pin exactly.
  const pet = manifest.customizations.find((item) => item.id === 'dsh-pet')
  assert.equal(pet.hostRuntimeCompatibility.supportedDshVersion, manifest.dshVersion)
  assert.match(builder, /const run = \(command, args, cwd = here, options\)/)
  assert.match(builder, /pnpm@11\.7\.0', 'install', '--prefer-offline'\], checkout, \{ env: \{ CI: 'true' \} \}/)
  assert.match(builder, /reviewed DSH source requires Node \^22\.19\.0 or >=24\.0\.0/)
})

test('both retained extension hashes match their reviewed templates and pins', async () => {
  for (const [group, pin] of [['model-display', 'modelDisplayPatchSha256'], ['team-membership', 'teamMembershipHash']]) {
    const patch = await readFile(path.join(COMPAT, `${group}.patch`))
    const template = JSON.parse(await text(`${group}.package.template.json`))
    const hash = createHash('sha256').update(patch).digest('hex')
    assert.equal(template.patchSha256, hash)
    assert.ok((await text('build.mjs')).includes(hash), `${pin} must be pinned`)
  }
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

test('all four retired patches and their subagent template are absent', () => {
  for (const retired of ['settlement-notice.patch', 'package.template.json', 'inquiry-isolation.patch', 'newinquiry-tools-guard.patch', 'native-managed-effects.patch']) {
    assert.equal(existsSync(path.join(COMPAT, retired)), false, `${retired} must be removed`)
  }
})

test('the launcher installs reviewed overrides and safely publishes a self-contained runtime', async () => {
  const launcher = await text('build-launcher.cjs')

  assert.match(launcher, /'@deepseek-ai\/dsh': version/)
  assert.match(launcher, /const npmVersion = '11\.19\.0'/)
  assert.match(launcher, /runCompatCommand\('corepack', \[`npm@\$\{npmVersion\}`/)
  // The framework version is declared, not left to npm's resolution order:
  // several official packages pin cordis EXACTLY while others allow a range,
  // so a newer release satisfying the range first leaves the tree invalid.
  // Derived from the reviewed upstream tree, never pasted.
  assert.match(launcher, /const frameworkPins = Object\.fromEntries\(/)
  assert.match(launcher, /'@deepseek-ai\/cordis', '@deepseek-ai\/cordis-plugin-include'/)
  assert.doesNotMatch(launcher, /const frameworkPins[^]*?'4\.0\.\d'/)
  // The process-wide proxy dispatcher is built from this launcher's own undici
  // dependency and installed with `setGlobalDispatcher`, i.e. it becomes the
  // dispatcher the runtime's BUILT-IN fetch routes through. undici 8 is
  // unreadable there: every response arrives with zero headers and a still
  // compressed body, so each `response.json()` fails while SSE keeps working.
  // The tree is therefore pinned below the declared `^8.10.0`, and that pin is
  // a named, reviewed fact rather than a pasted literal in the overrides.
  assert.match(launcher, /const UNDICI_COMPAT_PIN = '\d+\.\d+\.\d+'/)
  assert.match(launcher, /undici: UNDICI_COMPAT_PIN/)
  // The actual compiled graph is checked by test-packaging.cjs with an
  // explicit PET_COMPAT_TEST_GRAPH; this source check pins its wiring only.
  assert.match(launcher, /verify-official-runtime\.mjs/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-subagent': `file:/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-agent': `file:/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-agent-loop': `file:/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-tools': `file:/)
  assert.doesNotMatch(launcher, /nativeToolsTemplate|agentLoopPatchSha256|toolsPatchSha256|managedEffectsPatchSha256/)
  assert.doesNotMatch(launcher, /overrideRuntimeAgent/)
  assert.match(launcher, /renameSync\(staging, buildDir\)/)
  assert.match(launcher, /publishLauncher\(\{ launcher, target: buildDir/)
  const publisher = await text('compat-publish.cjs')
  assert.match(publisher, /io\.renameSync\(next, launcher\)/)
  assert.match(publisher, /platform === 'win32'/)
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
