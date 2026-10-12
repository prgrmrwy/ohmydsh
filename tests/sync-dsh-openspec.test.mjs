import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { overlayFixture } from './helpers/overlay-fixture.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('dsh_openspec_clean_sync_then_noop_with_notice', async (t) => {
  const manifest = await readFile(path.join(REPO, 'dsh.yaml'), 'utf8')
  const pkg = JSON.parse(await readFile(path.join(REPO, 'packages/dsh-openspec/package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(REPO, 'package-lock.json'), 'utf8'))
  const customization = manifest.match(/- id: dsh-openspec[\s\S]*?(?=\n   - id:|\n\S|$)/)?.[0]

  assert.ok(customization, 'dsh-openspec must be declared as a customization')
  assert.match(customization, /source: local/)
  // One exact pin shared by package.json, the workspace lock entry and the resolved lock package.
  const pin = pkg.dependencies['@fission-ai/openspec']
  assert.match(pin, /^\d+\.\d+\.\d+$/)
  assert.equal(lock.packages['packages/dsh-openspec']?.dependencies?.['@fission-ai/openspec'], pin)
  assert.equal(lock.packages['node_modules/@fission-ai/openspec']?.version, pin)
  assert.match(await readFile(path.join(REPO, 'packages/dsh-openspec/NOTICE'), 'utf8'), /@codigoconelmer\/dsh-openspec@0\.1\.0/)

  const fx = await overlayFixture({
    externalRoot: false,
    manifest: `dshVersion: 0.1.5-rc.2\ncustomizations:\n  - id: dsh-openspec\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: true\n`,
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await cp(path.join(REPO, 'packages/dsh-openspec'), path.join(fx.repo, 'packages/dsh-openspec'), { recursive: true })
  await writeFile(path.join(fx.repo, 'package.json'), await readFile(path.join(REPO, 'package.json')))
  await writeFile(path.join(fx.repo, 'package-lock.json'), await readFile(path.join(REPO, 'package-lock.json')))

  const first = fx.sync()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /install local package dsh-openspec/)
  const second = fx.sync()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
  const notice = await readFile(path.join(fx.profile, 'node_modules/dsh-openspec/NOTICE'), 'utf8')
  assert.match(notice, /@codigoconelmer\/dsh-openspec@0\.1\.0/)
})

test('dsh_openspec_pin_mismatch_vs_lockfile_fails_without_profile_change', async (t) => {
  const fx = await overlayFixture({
    externalRoot: false,
    manifest: `dshVersion: 0.1.5-rc.2\ncustomizations:\n  - id: dsh-openspec\n    type: package\n    source: local\n    version: 0.1.0\n    enabled: true\n`,
  })
  t.after(() => rm(fx.root, { recursive: true, force: true }))
  await cp(path.join(REPO, 'packages/dsh-openspec'), path.join(fx.repo, 'packages/dsh-openspec'), { recursive: true })
  await writeFile(path.join(fx.repo, 'package.json'), await readFile(path.join(REPO, 'package.json')))
  const lock = JSON.parse(await readFile(path.join(REPO, 'package-lock.json'), 'utf8'))
  const pin = JSON.parse(await readFile(path.join(REPO, 'packages/dsh-openspec/package.json'), 'utf8')).dependencies['@fission-ai/openspec']
  const [major, minor, patch] = pin.split('.').map(Number)
  const stale = `${major}.${minor}.${patch + 1}` // any lock version that differs from the package.json pin
  lock.packages['packages/dsh-openspec'].dependencies['@fission-ai/openspec'] = stale
  lock.packages['node_modules/@fission-ai/openspec'].version = stale
  await writeFile(path.join(fx.repo, 'package-lock.json'), JSON.stringify(lock, null, 2))
  const before = await readFile(path.join(fx.profile, 'package.json'))

  const result = fx.sync()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /dsh-openspec-pin-mismatch/)
  assert.ok(result.stderr.includes(pin), result.stderr)
  assert.ok(result.stderr.includes(stale), result.stderr)
  assert.deepEqual(await readFile(path.join(fx.profile, 'package.json')), before)
})
