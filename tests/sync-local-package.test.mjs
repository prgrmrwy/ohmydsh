import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_SCRIPT = path.join(REPO, 'scripts', 'sync.mjs')

async function fixture({ build = true, remote = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-local-package-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const source = path.join(repo, 'packages', 'local-demo')
  await mkdir(path.join(repo, 'scripts'), { recursive: true })
  await mkdir(path.join(source, 'src'), { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(SYNC_SCRIPT))
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'fixture-root', private: true, type: 'module', workspaces: ['packages/*'],
  }))
  await writeFile(path.join(source, 'package.json'), JSON.stringify({
    name: 'dsh-local-demo',
    version: '1.0.0',
    type: 'module',
    files: ['lib', 'cordis.patch.yml'],
    scripts: build ? { build: 'node build.mjs' } : {},
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  await writeFile(path.join(source, 'cordis.patch.yml'), '- insert: []\n')
  await writeFile(path.join(source, 'src', 'value.txt'), 'first\n')
  await writeFile(path.join(source, 'src', 'asset.svg'), '<svg>first</svg>\n')
  if (build) {
    await writeFile(path.join(source, 'build.mjs'), `
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
const value = await readFile('src/value.txt', 'utf8')
const asset = await readFile('src/asset.svg', 'utf8')
await writeFile('lib/index.js', 'export const value = ' + JSON.stringify(value.trim()) + '; export const asset = ' + JSON.stringify(asset.trim()) + '\\n')
await writeFile('lib/build-count.txt', String(Number((await readFile('lib/build-count.txt', 'utf8').catch(() => '0'))) + 1))
`)
  } else {
    await mkdir(path.join(source, 'lib'), { recursive: true })
    await writeFile(path.join(source, 'lib', 'index.js'), 'export const value = "first"\n')
  }
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2))
  await writeFile(path.join(repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7
dependencies: []
customizations:
  - id: local-demo
    type: package
    source: local
    version: 1.0.0
    enabled: true
${remote ? `  - id: remote-demo
    type: package
    source: remote
    spec: remote-demo@1.0.0
    version: 1.0.0
    enabled: true
` : ''}`)

  const actions = path.join(root, 'actions.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
actions="${actions}"
action="$4"
value="$5"
printf '%s %s\\n' "$action" "$value" >> "$actions"
if [[ "$action" == add && "$value" == file:* ]]; then
  src="\${value#file:}"
  name=$(node -p "require('$src/package.json').name")
  rm -rf "$profile/node_modules/$name"
  mkdir -p "$profile/node_modules"
  cp -R "$src" "$profile/node_modules/$name"
elif [[ "$action" == add ]]; then
  name="\${value%@*}"
  version="\${value##*@}"
  mkdir -p "$profile/node_modules/$name"
  printf '{"name":"%s","version":"%s","dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}' "$name" "$version" > "$profile/node_modules/$name/package.json"
elif [[ "$action" == remove ]]; then
  rm -rf "$profile/node_modules/$value"
fi
`)
  await chmod(fake, 0o755)
  const run = (extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, ...extraEnv },
  })
  return { root, repo, dshHome, profile, source, actions, run }
}

async function actionLog(file) {
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

test('builds a clean local package before install and skips unchanged repeat sync', async () => {
  const fx = await fixture({ remote: true })
  assert.equal(existsSync(path.join(fx.source, 'lib')), false)

  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /build local package dsh-local-demo/)
  assert.match(first.stdout, /install local package/)
  assert.match(first.stdout, /install remote package/)
  assert.equal(await readFile(path.join(fx.source, 'lib', 'build-count.txt'), 'utf8'), '1')

  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.doesNotMatch(second.stdout, /build local package/)
  assert.match(second.stdout, /no changes/)
  assert.equal(await readFile(path.join(fx.source, 'lib', 'build-count.txt'), 'utf8'), '1')
})

test('rebuilds for source, asset, and missing-output changes then stays idempotent', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  const installed = path.join(fx.profile, 'node_modules', 'dsh-local-demo', 'lib', 'index.js')

  await writeFile(path.join(fx.source, 'src', 'value.txt'), 'second\n')
  const sourceChange = fx.run()
  assert.equal(sourceChange.status, 0, sourceChange.stderr)
  assert.match(sourceChange.stdout, /build local package/)
  assert.match(await readFile(installed, 'utf8'), /second/)

  await writeFile(path.join(fx.source, 'src', 'asset.svg'), '<svg>second</svg>\n')
  const assetChange = fx.run()
  assert.equal(assetChange.status, 0, assetChange.stderr)
  assert.match(assetChange.stdout, /build local package/)
  assert.match(await readFile(installed, 'utf8'), /<svg>second<\/svg>/)

  await rm(path.join(fx.source, 'lib'), { recursive: true })
  const missingOutput = fx.run()
  assert.equal(missingOutput.status, 0, missingOutput.stderr)
  assert.match(missingOutput.stdout, /build local package/)
  assert.equal(existsSync(path.join(fx.source, 'lib', 'index.js')), true)

  const unchanged = fx.run()
  assert.equal(unchanged.status, 0, unchanged.stderr)
  assert.match(unchanged.stdout, /no changes/)
})

test('reports build failure before removing the previously deployed package', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  const installed = path.join(fx.profile, 'node_modules', 'dsh-local-demo', 'lib', 'index.js')
  const before = await readFile(installed, 'utf8')
  const actionsBefore = await actionLog(fx.actions)

  await writeFile(path.join(fx.source, 'src', 'value.txt'), 'broken\n')
  await writeFile(path.join(fx.source, 'build.mjs'), 'throw new Error("intentional build failure")\n')
  const failed = fx.run()

  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /failed before deployment/)
  assert.equal(await readFile(installed, 'utf8'), before)
  assert.equal(await actionLog(fx.actions), actionsBefore)
})

test('reinstalls a native-JavaScript local package when publishable content changes', async () => {
  const fx = await fixture({ build: false })
  assert.equal(fx.run().status, 0)
  const installed = path.join(fx.profile, 'node_modules', 'dsh-local-demo', 'lib', 'index.js')
  await writeFile(path.join(fx.source, 'lib', 'index.js'), 'export const value = "second"\n')
  const changed = fx.run()
  assert.equal(changed.status, 0, changed.stderr)
  assert.match(changed.stdout, /content changed, reinstalling/)
  assert.match(await readFile(installed, 'utf8'), /second/)
})

test('garbage-collects local build and install hashes when a package is disabled', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  await writeFile(path.join(fx.repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7\ndependencies: []\ncustomizations:\n  - id: local-demo\n    type: package\n    source: local\n    version: 1.0.0\n    enabled: false\n`)

  const disabled = fx.run()
  assert.equal(disabled.status, 0, disabled.stderr)
  const state = JSON.parse(await readFile(path.join(fx.dshHome, '.dsh-sync-state.json'), 'utf8'))
  assert.deepEqual(state.localPackageHashes, {})
  assert.deepEqual(state.localPackageBuildInputs, {})
})
