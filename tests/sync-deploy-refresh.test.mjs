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

/**
 * Fixture whose fake DSH CLI mimics pnpm v10's REAL `file:` directory
 * dependency semantics: installation MERGES — files that already exist in
 * the deployed copy (subtree files in particular) are never overwritten.
 * This is the deployment-side regression the sync content-drift refresh
 * path exists for. Optional fault injections:
 *   - `.sync-fail`  in the source dir  -> the add command fails (exit 1)
 *   - `.sync-corrupt`                 -> add succeeds but writes a tampered
 *                                       lib/index.js (re-verify mismatch)
 */
async function fixture({ build = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-refresh-'))
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
  if (build) {
    await writeFile(path.join(source, 'build.mjs'), `
import { mkdir, readFile, writeFile } from 'node:fs/promises'
await mkdir('lib', { recursive: true })
const value = await readFile('src/value.txt', 'utf8')
await writeFile('lib/index.js', 'export const value = ' + JSON.stringify(value.trim()) + '\\n')
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
  if [[ -e "$src/.sync-fail" ]]; then
    echo "injected add failure" >&2
    exit 1
  fi
  mkdir -p "$profile/node_modules/$name"
  # pnpm merge-without-overwrite: copy only files that are NOT already present.
  (cd "$src" && find . -type f ! -name '.sync-fail' ! -name '.sync-corrupt' | while read -r f; do
    if [[ ! -e "$profile/node_modules/$name/$f" ]]; then
      mkdir -p "$profile/node_modules/$name/$(dirname "$f")"
      cp "$f" "$profile/node_modules/$name/$f"
    fi
  done)
  if [[ -e "$src/.sync-corrupt" ]]; then
    echo 'export const value = "TAMPERED with"' >> "$profile/node_modules/$name/lib/index.js"
  fi
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
  const run = (extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, ...extraEnv },
  })
  return { root, profile, source, actions, run }
}

async function actionLog(file) {
  return existsSync(file) ? readFile(file, 'utf8') : ''
}

function setValue(source, text) {
  return writeFile(path.join(source, 'src', 'value.txt'), `${text}\n`)
}

const deployedIndex = (profile) => path.join(profile, 'node_modules', 'dsh-local-demo', 'lib', 'index.js')

test('content drift with stale deployed subtree forces atomic refresh (pnpm merge semantics)', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  const addsAfterInstall = (await actionLog(fx.actions)).trim().split('\n').filter((l) => l.startsWith('add ')).length
  // Simulate pnpm's merge-without-overwrite remnant: the deployed copy keeps
  // the OLD lib/index.js while the source moves on.
  await setValue(fx.source, 'second')
  assert.equal(fx.run().status, 0, 'sync must succeed')
  assert.match(await readFile(deployedIndex(fx.profile), 'utf8'), /"second"/)
  // The drift run performed exactly ONE refresh (evict + add) — a plain
  // re-add under merge semantics would have left "first" behind.
  const adds = (await actionLog(fx.actions)).trim().split('\n').filter((l) => l.startsWith('add ')).length
  assert.equal(adds, addsAfterInstall + 1)
})

test('deployment already matching source is not reinstalled', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  const before = await actionLog(fx.actions)
  await setValue(fx.source, 'second')
  // Align the deployed copy manually (the "other means" of refreshing).
  await writeFile(deployedIndex(fx.profile), 'export const value = "second"\n')
  const changed = fx.run()
  assert.equal(changed.status, 0, changed.stderr)
  assert.match(changed.stdout, /deployment already matches source/)
  assert.equal(await actionLog(fx.actions), before, 'no add performed')
  // And the state now records the new hash: next sync is a no-op.
  const next = fx.run()
  assert.equal(next.status, 0)
  assert.match(next.stdout, /no changes|up-to-date/)
})

test('failed refresh restores the previous deployment and sync reports the failure', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  await writeFile(path.join(fx.source, '.sync-fail'), 'boom\n')
  await setValue(fx.source, 'second')
  const failed = fx.run()
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /failed to refresh deployment/)
  assert.match(await readFile(deployedIndex(fx.profile), 'utf8'), /"first"/, 'previous deployment restored')
  // After the fault is removed the next run heals the drift.
  await rm(path.join(fx.source, '.sync-fail'))
  const healed = fx.run()
  assert.equal(healed.status, 0, healed.stderr)
  assert.match(await readFile(deployedIndex(fx.profile), 'utf8'), /"second"/)
})

test('verification mismatch after re-add restores the old copy and never accepts tampered bytes', async () => {
  const fx = await fixture()
  assert.equal(fx.run().status, 0)
  const addsAfterInstall = (await actionLog(fx.actions)).trim().split('\n').filter((l) => l.startsWith('add ')).length
  await writeFile(path.join(fx.source, '.sync-corrupt'), 'x\n')
  await setValue(fx.source, 'second')
  const failed = fx.run()
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /refresh verification mismatch|failed to refresh deployment/)
  // Old deployment restored — the tampered "add" output was never accepted.
  assert.match(await readFile(deployedIndex(fx.profile), 'utf8'), /"first"/)
  // One add attempt only for the failed run (no retry loop within the run).
  const adds = (await actionLog(fx.actions)).trim().split('\n').filter((l) => l.startsWith('add ')).length
  assert.equal(adds, addsAfterInstall + 1)
})