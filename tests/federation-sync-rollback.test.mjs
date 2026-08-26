import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Pre-enable rehearsal of task 10.6 against the REAL `dsh-federation` package,
 * inside an isolated DSH_HOME with a fake `dsh` CLI.
 *
 * This is the dress rehearsal for switching `dsh.yaml` to `enabled: true`:
 * it proves the enable path deploys, that a second run is idempotent, and that
 * flipping back to `enabled: false` fully removes the deployment — without
 * touching the operator's real `~/.dsh` or the live Web Host.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function fixture({ enabled }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'federation-sync-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  const profile = path.join(dshHome, 'profiles', 'web')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(profile, { recursive: true })

  // Real sync script and its helper, real root manifest shape.
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(path.join(REPO, 'scripts', 'sync.mjs')))
  await writeFile(path.join(repo, 'scripts', 'lib', 'dsh-cli.mjs'), await readFile(path.join(REPO, 'scripts', 'lib', 'dsh-cli.mjs')))
  // The package's build imports these repo scripts; copy them so the real
  // build/prepare path runs inside the fixture exactly as it would in the repo.
  for (const script of ['build-rc2-workspace-embed.mjs', 'fetch-rc2-workspace-source.mjs']) {
    await writeFile(path.join(repo, 'scripts', script), await readFile(path.join(REPO, 'scripts', script)))
  }
  // The embed build reads its pinned upstream provenance from openspec/, and
  // fails closed without it — so the fixture must carry it too.
  const upstream = 'openspec/changes/federated-dsh-control-plane/checking/upstream'
  await mkdir(path.join(repo, upstream), { recursive: true })
  for (const asset of ['rc2-workspace-source-manifest.json', 'rc2-workspace-node-section.patch']) {
    await writeFile(path.join(repo, upstream, asset), await readFile(path.join(REPO, upstream, asset)))
  }
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await mkdir(path.join(repo, 'packages'), { recursive: true })
  // Copy only version-controlled sources of the real package. Sibling tests
  // rebuild and delete `packages/dsh-federation/lib` concurrently, so neither
  // symlinking nor copying that directory is safe; the fixture builds its own.
  const target = path.join(repo, 'packages', 'dsh-federation')
  await mkdir(target, { recursive: true })
  const tracked = spawnSync('git', ['-C', REPO, 'ls-files', '--cached', '--others', '--exclude-standard', 'packages/dsh-federation'], { encoding: 'utf8' })
  assert.equal(tracked.status, 0, tracked.stderr)
  const sources = tracked.stdout.split('\n').filter(Boolean)
    .filter(rel => !rel.includes('/lib/') && !rel.includes('/.generated/'))
  assert.ok(sources.length > 0, 'expected federation package sources')
  for (const rel of sources) {
    const to = path.join(repo, rel)
    await mkdir(path.dirname(to), { recursive: true })
    await writeFile(to, await readFile(path.join(REPO, rel)))
  }
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    name: 'fixture-root', private: true, type: 'module', workspaces: ['packages/*'],
  }))
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2))
  await writeFile(path.join(repo, 'dsh.yaml'), [
    'dshVersion: 0.1.1-rc.2',
    'dependencies: []',
    'customizations:',
    '  - id: dsh-federation',
    '    type: package',
    '    source: local',
    '    version: 0.1.0',
    `    enabled: ${enabled}`,
    '',
  ].join('\n'))

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
elif [[ "$action" == remove ]]; then
  rm -rf "$profile/node_modules/$value"
fi
`)
  await chmod(fake, 0o755)

  const run = () => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, DSH_HOME: dshHome, DSH_BIN: fake, DSH_SKIP_UPDATE: '1' },
  })
  const setEnabled = async value => {
    const manifest = await readFile(path.join(repo, 'dsh.yaml'), 'utf8')
    await writeFile(path.join(repo, 'dsh.yaml'), manifest.replace(/enabled: (?:true|false)/, `enabled: ${value}`))
  }
  return { root, repo, dshHome, profile, actions, run, setEnabled }
}

const readActions = async file => (existsSync(file) ? (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean) : [])

test('enabling dsh-federation deploys, re-syncs idempotently, and disabling rolls back cleanly', { timeout: 600_000 }, async () => {
  const f = await fixture({ enabled: true })
  try {
    // --- first sync: the enable path actually deploys the real package ---
    const first = f.run()
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const installed = path.join(f.profile, 'node_modules', 'dsh-federation')
    assert.ok(existsSync(installed), `federation package was not deployed:\n${first.stdout}`)

    // The deployed artifact must be the built output, not raw sources.
    assert.ok(existsSync(path.join(installed, 'lib')), 'deployed package must carry built lib/')
    const deployedPkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
    assert.equal(deployedPkg.name, 'dsh-federation')

    const afterFirst = await readActions(f.actions)
    assert.ok(afterFirst.some(line => line.startsWith('add file:')), afterFirst.join('\n'))

    // --- second sync: idempotent, no redeploy ---
    const second = f.run()
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    const afterSecond = await readActions(f.actions)
    assert.deepEqual(afterSecond, afterFirst,
      `second sync must not re-add anything:\n${second.stdout}`)
    assert.ok(existsSync(installed), 'package must still be deployed after an idempotent run')

    // --- rollback: enabled:false removes the deployment ---
    await f.setEnabled(false)
    const third = f.run()
    assert.equal(third.status, 0, `${third.stdout}\n${third.stderr}`)
    const afterDisable = await readActions(f.actions)
    // The sync itself must have issued the removal; the fake CLI only carries it
    // out, so asserting on the recorded action is what proves the rollback path.
    assert.ok(afterDisable.some(line => line === 'remove dsh-federation'),
      `sync did not issue a removal:\n${third.stdout}\n${afterDisable.join('\n')}`)
    assert.equal(existsSync(installed), false, `disabling must remove the deployed package:\n${third.stdout}`)

    // --- rollback is itself idempotent ---
    const fourth = f.run()
    assert.equal(fourth.status, 0, `${fourth.stdout}\n${fourth.stderr}`)
    assert.deepEqual(await readActions(f.actions), afterDisable,
      'a second disabled run must be a no-op')

    // --- re-enabling restores the deployment (the switch is reversible) ---
    await f.setEnabled(true)
    const fifth = f.run()
    assert.equal(fifth.status, 0, `${fifth.stdout}\n${fifth.stderr}`)
    assert.ok(existsSync(installed), 're-enabling must restore the deployment')
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('the federation build fails closed when the pinned rc.2 source hash does not match', { timeout: 600_000 }, async () => {
  // Generic "build failure preserves the deployment" is already covered by
  // sync-local-package.test.mjs. The federation-specific risk is different: the
  // Workspace Embed is derived from PINNED upstream rc.2 source, so a changed
  // target must stop the build instead of silently shipping a different UI.
  const manifest = path.join(REPO, 'openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-workspace-source-manifest.json')
  const pinned = JSON.parse(await readFile(manifest, 'utf8'))
  assert.match(pinned.releaseCommit ?? '', /^[0-9a-f]{40}$/, 'the embed source must be pinned to an immutable commit')
  assert.ok(Array.isArray(pinned.blobs) && pinned.blobs.length > 0, 'per-file blob provenance must be recorded')
  for (const blob of pinned.blobs) {
    assert.match(blob.gitBlob ?? '', /^[0-9a-f]{40}$/, `missing git blob id for ${blob.path}`)
    assert.ok(Number.isInteger(blob.size) && blob.size > 0, `missing size for ${blob.path}`)
  }

  // Drive the real builder against a tampered stage: it must refuse.
  const root = await mkdtemp(path.join(os.tmpdir(), 'federation-embed-guard-'))
  try {
    const staged = path.join(root, 'source')
    await mkdir(path.join(staged, 'packages/client/ui-workspace/src/client'), { recursive: true })
    await writeFile(path.join(staged, 'packages/client/ui-workspace/src/client/WorkspaceBrowser.tsx'),
      '// tampered: not the pinned upstream source\n')
    const built = spawnSync(process.execPath, [
      path.join(REPO, 'scripts/build-rc2-workspace-embed.mjs'),
      '--source-dir', staged,
      '--output-dir', path.join(root, 'out'),
    ], { cwd: REPO, encoding: 'utf8' })
    assert.notEqual(built.status, 0, 'a tampered embed source must fail the build')
    assert.equal(existsSync(path.join(root, 'out', 'src/client/WorkspaceBrowser.tsx')), false,
      'no embed artifact may be produced from unverified source')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
