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
  for (const script of [
    'build-rc2-workspace-embed.mjs',
    'fetch-rc2-workspace-source.mjs',
    'build-rc2-connection-compat.mjs',
    'fetch-rc2-connection-source.mjs',
  ]) {
    await writeFile(path.join(repo, 'scripts', script), await readFile(path.join(REPO, 'scripts', script)))
  }
  // The embed build reads its pinned upstream provenance from openspec/, and
  // fails closed without it — so the fixture must carry it too.
  const upstream = 'openspec/changes/federated-dsh-control-plane/checking/upstream'
  await mkdir(path.join(repo, upstream), { recursive: true })
  for (const asset of [
    'rc2-workspace-source-manifest.json',
    'rc2-workspace-node-section.patch',
    'rc2-connection-source-manifest.json',
    'rc2-connection-api-middleware.patch',
  ]) {
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
  await writeFile(path.join(repo, 'package-lock.json'), await readFile(path.join(REPO, 'package-lock.json')))
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
    '    buildInputs:',
    '      - package-lock.json',
    '      - scripts/build-rc2-workspace-embed.mjs',
    '      - scripts/fetch-rc2-workspace-source.mjs',
    '      - openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-workspace-source-manifest.json',
    '      - openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-workspace-node-section.patch',
    '      - scripts/build-rc2-connection-compat.mjs',
    '      - scripts/fetch-rc2-connection-source.mjs',
    '      - openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-connection-source-manifest.json',
    '      - openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-connection-api-middleware.patch',
    '    compatDependencies:',
    "      - name: '@deepseek-ai/dsh-client-connection'",
    '        path: lib/connection',
    '',
  ].join('\n'))

  const actions = path.join(root, 'actions.log')
  const fake = path.join(root, 'fake-dsh.sh')
  await writeFile(fake, `#!/bin/bash
set -euo pipefail
profile="${profile}"
actions="${actions}"
action="$4"
shift 4
printf '%s %s\\n' "$action" "$*" >> "$actions"
if [[ "$action" == add ]]; then
  for value in "$@"; do
    [[ "$value" == file:* ]] || continue
    src="\${value#file:}"
    name=$(node -p "require('$src/package.json').name")
    rm -rf "$profile/node_modules/$name"
    mkdir -p "$(dirname "$profile/node_modules/$name")"
    cp -R "$src" "$profile/node_modules/$name"
    node -e "const fs=require('fs');const f='$profile/package.json';const p=JSON.parse(fs.readFileSync(f));p.dependencies??={};p.dependencies[process.argv[1]]=process.argv[2];fs.writeFileSync(f,JSON.stringify(p,null,2))" "$name" "$value"
  done
elif [[ "$action" == remove ]]; then
  for value in "$@"; do
    rm -rf "$profile/node_modules/$value"
    node -e "const fs=require('fs');const f='$profile/package.json';const p=JSON.parse(fs.readFileSync(f));delete p.dependencies?.[process.argv[1]];fs.writeFileSync(f,JSON.stringify(p,null,2))" "$value"
  done
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
    const installedConnection = path.join(f.profile, 'node_modules', '@deepseek-ai', 'dsh-client-connection')
    assert.ok(existsSync(installed), `federation package was not deployed:\n${first.stdout}`)
    assert.ok(existsSync(installedConnection), `patched Connection was not deployed:\n${first.stdout}`)

    // Both deployed artifacts must be built outputs, not raw sources. The
    // compatibility package deliberately preserves the official package name so
    // the unchanged DSH Connection row and browser dependency graph resolve it.
    assert.ok(existsSync(path.join(installed, 'lib')), 'deployed package must carry built lib/')
    const deployedPkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
    const connectionPkg = JSON.parse(await readFile(path.join(installedConnection, 'package.json'), 'utf8'))
    assert.equal(deployedPkg.name, 'dsh-federation')
    assert.equal(connectionPkg.name, '@deepseek-ai/dsh-client-connection')
    assert.equal(connectionPkg.federationProvenance.patchSha256,
      'e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9')
    const hostArtifact = await readFile(path.join(installedConnection, 'lib/index.js'), 'utf8')
    assert.match(hostArtifact, /apiMiddleware/, 'deployed Connection must contain the middleware seam')

    const afterFirst = await readActions(f.actions)
    assert.ok(afterFirst.some(line => line.startsWith('add ') &&
      line.includes('lib/connection') && line.includes('packages/dsh-federation')),
    `Connection and federation must deploy in one add transaction:\n${afterFirst.join('\n')}`)

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
    assert.ok(afterDisable.some(line => line ===
      'remove dsh-federation @deepseek-ai/dsh-client-connection'),
      `sync did not issue one atomic owner+compat removal:\n${third.stdout}\n${afterDisable.join('\n')}`)
    assert.equal(existsSync(installed), false, `disabling must remove the deployed package:\n${third.stdout}`)
    assert.equal(existsSync(installedConnection), false,
      `disabling must remove the direct Connection override:\n${third.stdout}`)

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

test('a changed Connection patch fails before deployment and preserves the installed pair', { timeout: 600_000 }, async () => {
  const f = await fixture({ enabled: true })
  try {
    const first = f.run()
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const installedFederation = path.join(f.profile, 'node_modules', 'dsh-federation', 'lib', 'index.js')
    const installedConnection = path.join(f.profile, 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'lib/index.js')
    const federationBefore = await readFile(installedFederation)
    const connectionBefore = await readFile(installedConnection)
    const actionsBefore = await readActions(f.actions)

    const patch = path.join(f.repo,
      'openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-connection-api-middleware.patch')
    const original = await readFile(patch, 'utf8')
    await writeFile(patch, `${original}\n# tampered deployment input\n`)
    const failed = f.run()
    assert.notEqual(failed.status, 0)
    assert.match(failed.stderr, /connection compatibility patch sha256 mismatch/)
    assert.deepEqual(await readActions(f.actions), actionsBefore,
      'a failed fixed-source build must not invoke package deployment')
    assert.deepEqual(await readFile(installedFederation), federationBefore)
    assert.deepEqual(await readFile(installedConnection), connectionBefore)

    await writeFile(patch, original)
    const recovered = f.run()
    assert.equal(recovered.status, 0, `${recovered.stdout}\n${recovered.stderr}`)
    assert.deepEqual(await readActions(f.actions), actionsBefore,
      'restoring unchanged fixed inputs must remain deployment-idempotent')
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('root lockfile participates in the local build identity', { timeout: 600_000 }, async () => {
  const f = await fixture({ enabled: true })
  try {
    const first = f.run()
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const lock = path.join(f.repo, 'package-lock.json')
    await writeFile(lock, `${await readFile(lock, 'utf8')}\n`)
    const second = f.run()
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
    assert.match(second.stdout, /build local package dsh-federation/,
      'changing the pinned root lockfile must invalidate the local build cache')
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('an active owner cannot silently drop its required compatibility override', { timeout: 600_000 }, async () => {
  const f = await fixture({ enabled: true })
  try {
    const first = f.run()
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    const actionsBefore = await readActions(f.actions)
    const connection = path.join(f.profile, 'node_modules', '@deepseek-ai', 'dsh-client-connection', 'lib/index.js')
    const connectionBefore = await readFile(connection)
    const manifestPath = path.join(f.repo, 'dsh.yaml')
    const manifest = await readFile(manifestPath, 'utf8')
    await writeFile(manifestPath, manifest.replace(
      /    compatDependencies:\n      - name: '@deepseek-ai\/dsh-client-connection'\n        path: lib\/connection\n/,
      '',
    ))

    const rejected = f.run()
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /refusing to remove or rename active compatibility overrides/)
    assert.deepEqual(await readActions(f.actions), actionsBefore)
    assert.deepEqual(await readFile(connection), connectionBefore)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('disabling after a fresh fixed-source build failure removes the staged owner dependency spec', { timeout: 600_000 }, async () => {
  const f = await fixture({ enabled: true })
  try {
    const patch = path.join(f.repo,
      'openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-connection-api-middleware.patch')
    await writeFile(patch, `${await readFile(patch, 'utf8')}\n# tampered before first deployment\n`)
    const failed = f.run()
    assert.notEqual(failed.status, 0)
    assert.deepEqual(await readActions(f.actions), [])
    let profilePkg = JSON.parse(await readFile(path.join(f.profile, 'package.json'), 'utf8'))
    assert.ok(profilePkg.dependencies['dsh-federation'], 'sync stages the local owner path before build')

    await f.setEnabled(false)
    const disabled = f.run()
    assert.equal(disabled.status, 0, `${disabled.stdout}\n${disabled.stderr}`)
    assert.deepEqual(await readActions(f.actions), ['remove dsh-federation'])
    profilePkg = JSON.parse(await readFile(path.join(f.profile, 'package.json'), 'utf8'))
    assert.equal(profilePkg.dependencies['dsh-federation'], undefined)
    assert.equal(profilePkg.dependencies['@deepseek-ai/dsh-client-connection'], undefined)
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('the Workspace embed build fails closed when the pinned rc.2 source hash does not match', { timeout: 600_000 }, async () => {
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
