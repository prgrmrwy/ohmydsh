/**
 * Build freshness: a local package's `lib/` must be provably built from the
 * CURRENT source before it is deployed.
 *
 * The gap these cases pin sits BETWEEN two mechanisms that each work
 * correctly. `sync` decides whether to rebuild from the input side only —
 * whether the source hash moved since last run, and whether `lib/` exists —
 * so it cannot tell "these outputs came from this source" from "these
 * outputs merely exist". `sync-local-deploy-refresh` then guarantees
 * "deployed copy == source `lib/`", which is faithful but assumes the source
 * `lib/` is itself current.
 *
 * When the source hash matches the ledger while `lib/` is from somewhere else
 * (another checkout, a branch switch, a rebase), nothing rebuilds and the
 * stale artifact is deployed atomically, verified, and reported as success.
 * The failure is silent: correct log lines, matching hashes, exit code 0.
 *
 * The fixture mirrors `sync-deploy-refresh.test.mjs` (same fake CLI with
 * pnpm's merge-without-overwrite semantics, same temporary `DSH_HOME`) so
 * both suites exercise one deployment contract rather than two dialects.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SYNC_SCRIPT = path.join(REPO, 'scripts', 'sync.mjs')

/** Build a repo + fake DSH home whose local package compiles src -> lib. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-freshness-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  const source = path.join(repo, 'packages', 'local-demo')
  const second = path.join(repo, 'packages', 'other-demo')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(path.join(source, 'src'), { recursive: true })
  await mkdir(path.join(second, 'src'), { recursive: true })
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(SYNC_SCRIPT))
  await writeFile(
    path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'),
    await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')),
  )
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-host-runtime.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-host-runtime.mjs')))
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture-root', private: true, type: 'module', workspaces: ['packages/*'] }),
  )

  // `build.mjs` derives lib from src, so "lib disagrees with src" is a state
  // the test can create precisely — and only by tampering with lib.
  const buildScript = `
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
const value = await readFile('src/value.txt', 'utf8')
await writeFile('lib/index.js', 'export const value = ' + JSON.stringify(value.trim()) + '\\n')
`
  for (const [dir, name] of [[source, 'dsh-local-demo'], [second, 'dsh-other-demo']]) {
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({
      name,
      version: '1.0.0',
      type: 'module',
      files: ['lib', 'cordis.patch.yml'],
      scripts: { build: 'node build.mjs' },
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(path.join(dir, 'cordis.patch.yml'), '- insert: []\n')
    await writeFile(path.join(dir, 'src', 'value.txt'), 'first\n')
    await writeFile(path.join(dir, 'build.mjs'), buildScript)
  }

  await writeFile(
    path.join(profile, 'package.json'),
    JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2),
  )
  await writeFile(path.join(repo, 'dsh.yaml'), `dshVersion: 0.1.0-rc.7
dependencies: []
customizations:
  - id: local-demo
    type: package
    source: local
    version: 1.0.0
    enabled: true
  - id: other-demo
    type: package
    source: local
    version: 1.0.0
    enabled: true
`)

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
  mkdir -p "$profile/node_modules/$name"
  # pnpm v10 merge-without-overwrite: never replace an existing file.
  (cd "$src" && find . -type f | while read -r f; do
    if [[ ! -e "$profile/node_modules/$name/$f" ]]; then
      mkdir -p "$profile/node_modules/$name/$(dirname "$f")"
      cp "$f" "$profile/node_modules/$name/$f"
    fi
  done)
  node -e "
    const fs=require('fs');
    const p=JSON.parse(fs.readFileSync('$profile/package.json','utf8'));
    p.dependencies=p.dependencies||{};
    p.dependencies['$name']='$value';
    fs.writeFileSync('$profile/package.json', JSON.stringify(p,null,2));
  "
elif [[ "$action" == remove ]]; then
  rm -rf "$profile/node_modules/$value"
fi
`)
  await chmod(fake, 0o755)

  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake },
  })
  const statePath = path.join(dshHome, '.dsh-sync-state.json')
  return { root, repo, profile, source, second, actions, run, statePath }
}

const deployed = (profile, name = 'dsh-local-demo') =>
  path.join(profile, 'node_modules', name, 'lib', 'index.js')
const sourceLib = (dir) => path.join(dir, 'lib', 'index.js')

/** Overwrite the built artifact while leaving `src/` untouched. */
const staleArtifact = (dir) =>
  writeFile(sourceLib(dir), 'export const value = "STALE"\n')

const readState = async (statePath) => JSON.parse(await readFile(statePath, 'utf8'))

test('rebuilds when lib/ was not produced by the current src (source hash unchanged)', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  assert.match(await readFile(deployed(fx.profile), 'utf8'), /"first"/)

  // The exact real-world state: `src/` is untouched (so its hash still matches
  // the ledger) but `lib/` came from elsewhere. Reproduces the 2026-09-08
  // incident, where a fixed source shipped as a stale artifact twice.
  await staleArtifact(fx.source)

  const run = fx.run()
  assert.equal(run.status, 0, run.stderr)

  // Rebuilding from the untouched `src/` must restore "first". Without the
  // freshness check sync skips the build and deploys "STALE" — atomically,
  // hash-verified, exit code 0, and completely wrong.
  assert.match(
    await readFile(sourceLib(fx.source), 'utf8'),
    /"first"/,
    'source lib/ must be rebuilt from current src/',
  )
  assert.match(
    await readFile(deployed(fx.profile), 'utf8'),
    /"first"/,
    'deployed copy must carry the rebuilt artifact, never the stale one',
  )
})

test('rebuilds when the generation record is missing (upgrade from an older ledger)', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)

  // An older ledger simply has no generation record. Dropping every unknown
  // key keeps this honest about what "upgrade" means without naming the new
  // field: whatever proves generation must be absent.
  const state = await readState(fx.statePath)
  for (const key of Object.keys(state)) {
    if (key.startsWith('localPackage') && key !== 'localPackageHashes') delete state[key]
  }
  await writeFile(fx.statePath, JSON.stringify(state, null, 2))
  await staleArtifact(fx.source)

  const run = fx.run()
  assert.equal(run.status, 0, run.stderr)
  assert.match(
    await readFile(deployed(fx.profile), 'utf8'),
    /"first"/,
    'unprovable generation must rebuild rather than assume the artifact is current',
  )
})

test('does not rebuild when the artifact is provably current, and stays idempotent', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)

  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  assert.doesNotMatch(first.stdout, /build local package/, 'no rebuild when nothing moved')

  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.doesNotMatch(second.stdout, /build local package/)
  assert.match(second.stdout, /no changes|up-to-date/)
})

test('a stale artifact in one package does not rebuild the others', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)

  await staleArtifact(fx.source)
  const run = fx.run()
  assert.equal(run.status, 0, run.stderr)

  // Only the affected package is rebuilt; the healthy one stays untouched.
  assert.match(run.stdout, /build local package dsh-local-demo/)
  assert.doesNotMatch(run.stdout, /build local package dsh-other-demo/)
  assert.match(await readFile(deployed(fx.profile), 'utf8'), /"first"/)
  assert.match(await readFile(deployed(fx.profile, 'dsh-other-demo'), 'utf8'), /"first"/)
})
