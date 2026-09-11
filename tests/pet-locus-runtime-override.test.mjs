import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
  // source patch across an unknown upstream implementation.
  assert.equal(manifest.dshVersion, '0.1.2-rc.1')
  assert.match(launcher, /const version = '0\.1\.2-rc\.1'/)
  assert.match(builder, /tag: 'dsh-v0\.1\.2-rc\.1'/)
  assert.match(builder, /commit: 'a66e4702047846cdaa10c66c9d3df3951f5ea70d'/)
  assert.match(builder, /const run = \(command, args, cwd = here\)/)
})

test('the recorded patch hashes match the reviewable patches on disk', async () => {
  const patch = await readFile(path.join(COMPAT, 'settlement-notice.patch'))
  const storagePatch = await readFile(path.join(COMPAT, 'storage-atomic.patch'))
  const builder = await text('build.mjs')
  const storageBuilder = await text('build-storage.mjs')
  const actual = createHash('sha256').update(patch).digest('hex')
  const storageActual = createHash('sha256').update(storagePatch).digest('hex')

  assert.match(builder, new RegExp(`patchSha256:\\s*'${actual}'`))
  assert.match(storageBuilder, new RegExp(`patchSha256 = '${storageActual}'`))
})

test('the patch carries behavior, compatibility, and a runtime capability marker', async () => {
  const patch = await text('settlement-notice.patch')

  assert.match(patch, /settlementNotice/)
  assert.match(patch, /SUPPORTED_DESCRIPTOR_VERSIONS/)
  assert.match(patch, /supportsSettlementNotice/)
  assert.match(patch, /if \(activation\.settlementNotice === 'silent'\) return/)
})

test('the launcher installs reviewed overrides and atomically publishes a self-contained runtime', async () => {
  const launcher = await text('build-launcher.cjs')

  assert.match(launcher, /'@deepseek-ai\/dsh': version/)
  assert.match(launcher, /const npmVersion = '11\.19\.0'/)
  assert.match(launcher, /run\('corepack', \[`npm@\$\{npmVersion\}`/)
  assert.match(launcher, /'@deepseek-ai\/dsh-subagent': `file:\$\{join\(compatPackages, 'subagent'\)\}`/)
  assert.match(launcher, /'@deepseek-ai\/dsh-storage-domain': `file:/)
  assert.match(launcher, /'@deepseek-ai\/dsh-storage-sqlite': `file:/)
  assert.match(launcher, /runNpm\(\['ls', '@deepseek-ai\/dsh-subagent', \.\.\.expectedRuntimeStorage\]/)
  assert.match(launcher, /renameSync\(staging, buildDir\)/)
  assert.match(launcher, /renameSync\(nextLink, launcher\)/)
  assert.match(launcher, /realpathSync\(here\)/)
  assert.match(launcher, /acquireCompatBuildLock/)
  assert.doesNotMatch(launcher, /node_modules\/\.npm\/_npx/)
})

test('generated runtime and launcher files remain out of version control', async () => {
  const ignore = await text('.gitignore')

  for (const entry of ['lib/', '.upstream/', '.launcher', '.launcher-builds/', 'package.json']) {
    assert.match(ignore, new RegExp(`^${entry.replaceAll('.', '\\.').replace('/', '\\/')}$`, 'm'))
  }
})
