// Local manifest overlay: append-only customizations from an out-of-version-control
// file. Observability follows the enabledEnv suite's approach — `type: patch`
// entries need no package install, and materialization is visible as a
// `fragment: <id>` marker in the generated cordis.patch.yml.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COPIED_LIBS = ['dsh-cli.mjs', 'dsh-host-runtime.mjs', 'manifest-overlay.mjs']

/**
 * Build a throwaway repo + DSH home.
 *
 * @param options
 * @param options.publicItems - ids materialized through the public manifest.
 * @param options.overlay - overlay file body, or undefined for "no overlay".
 * @param options.overlayPatchIds - patch fragments to create for overlay entries.
 */
async function fixture({ publicItems = [], overlay, overlayPatchIds = [] } = {}) {
  // Deliberately avoids the word "overlay": one assertion checks that a missing
  // overlay produces no mention of it, and sync echoes absolute paths.
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-localman-'))
  const repo = path.join(root, 'repo')
  const dshHome = path.join(root, 'dsh-home')
  await mkdir(path.join(repo, 'scripts', 'lib'), { recursive: true })
  await mkdir(path.join(repo, 'patches'), { recursive: true })
  await mkdir(path.join(dshHome, 'profiles', 'web'), { recursive: true })
  await writeFile(path.join(repo, 'scripts', 'sync.mjs'), await readFile(path.join(REPO, 'scripts', 'sync.mjs')))
  for (const lib of COPIED_LIBS) {
    await writeFile(path.join(repo, 'scripts', 'lib', lib), await readFile(path.join(REPO, 'scripts', 'lib', lib)))
  }
  await symlink(path.join(REPO, 'node_modules'), path.join(repo, 'node_modules'), 'dir')
  await writeFile(
    path.join(dshHome, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }, null, 2) + '\n',
  )

  // `customizations:` with no entries parses as null, which sync rejects before
  // it ever reaches the overlay — use an explicit empty flow list instead.
  const publicBlock = publicItems.length === 0
    ? 'customizations: []\n'
    : `customizations:\n${publicItems.map((id) => `  - id: ${id}\n    type: patch\n    enabled: true`).join('\n')}\n`
  await writeFile(
    path.join(repo, 'dsh.yaml'),
    `dshVersion: 0.1.0-rc.7\ndependencies: []\n${publicBlock}`,
  )
  for (const id of [...publicItems, ...overlayPatchIds]) {
    await writeFile(path.join(repo, 'patches', `${id}.yml`), '- insert: []\n')
  }

  const overlayPath = path.join(repo, 'dsh.yaml.local')
  if (overlay !== undefined) await writeFile(overlayPath, overlay)

  const run = (extraEnv = {}) => spawnSync(process.execPath, [path.join(repo, 'scripts', 'sync.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, DSH_BIN: '/usr/bin/true', DSH_HOME: dshHome, DSH_LOCAL_MANIFEST: '', ...extraEnv },
  })

  const patchPath = path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml')
  const readPatch = async () => (existsSync(patchPath) ? readFile(patchPath, 'utf8') : undefined)
  return { root, repo, dshHome, overlayPath, patchPath, run, readPatch }
}

test('no overlay: sync behaves exactly as before', async () => {
  const fx = await fixture({ publicItems: ['pub-a'] })
  const result = fx.run()
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: pub-a/)
  // Absence must be silent — not a warning, not a note.
  assert.doesNotMatch(result.stdout + result.stderr, /overlay/i)
})

test('overlay entry is appended and materialized', async () => {
  const fx = await fixture({
    publicItems: ['pub-a'],
    overlay: 'customizations:\n  - id: local-only\n    type: patch\n    enabled: true\n',
    overlayPatchIds: ['local-only'],
  })
  const result = fx.run()
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: pub-a/)
  assert.match(patch, /fragment: local-only/)
})

test('overlay entry honours its own enabled: false', async () => {
  const fx = await fixture({
    overlay: 'customizations:\n  - id: local-off\n    type: patch\n    enabled: false\n',
    overlayPatchIds: ['local-off'],
  })
  const result = fx.run()
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch((await fx.readPatch()) ?? '', /fragment: local-off/)
})

test('id colliding with the public manifest is rejected', async () => {
  const fx = await fixture({
    publicItems: ['pub-a'],
    overlay: 'customizations:\n  - id: pub-a\n    type: patch\n    enabled: true\n',
  })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /pub-a/)
  assert.match(result.stderr, /only append|never override/i)
})

test('duplicate ids within the overlay are rejected', async () => {
  const fx = await fixture({
    overlay: 'customizations:\n  - id: dup\n    type: patch\n  - id: dup\n    type: patch\n',
  })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /duplicate id "dup"/)
})

test('overlay declaring a top-level field is rejected', async () => {
  for (const field of ['dshVersion: 9.9.9', 'autoUpdate:\n  enabled: true', 'web:\n  open: true', 'agentInstructions:\n  enabled: true', 'dependencies: []']) {
    const fx = await fixture({ overlay: `${field}\ncustomizations: []\n` })
    const result = fx.run()
    assert.notEqual(result.status, 0, `expected rejection for ${field}`)
    assert.match(result.stderr, /may only declare "customizations"/)
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('present but unparsable overlay fails closed', async () => {
  const fx = await fixture({ overlay: 'customizations:\n  - [unclosed\n' })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /failed to parse/)
})

test('overlay whose root is not a mapping fails closed', async () => {
  const fx = await fixture({ overlay: '[]\n' })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /root must be a mapping/)
})

test('DSH_LOCAL_MANIFEST replaces the default overlay path', async () => {
  const fx = await fixture({
    overlay: 'customizations:\n  - id: from-default\n    type: patch\n    enabled: true\n',
    overlayPatchIds: ['from-default', 'from-env'],
  })
  const external = path.join(fx.root, 'external.yaml')
  await writeFile(external, 'customizations:\n  - id: from-env\n    type: patch\n    enabled: true\n')

  const result = fx.run({ DSH_LOCAL_MANIFEST: external })
  assert.equal(result.status, 0, result.stderr)
  const patch = await fx.readPatch()
  assert.match(patch, /fragment: from-env/)
  // Replaces, never stacks: the repo-root overlay must be ignored entirely.
  assert.doesNotMatch(patch, /fragment: from-default/)
})

test('overlay entries are not exempt from per-field validation', async () => {
  // A remote package with a non-npm spec still requires an explicit name.
  const fx = await fixture({
    overlay: 'customizations:\n  - id: bad-remote\n    type: package\n    source: remote\n    spec: not-an-npm-spec\n    version: 1.0.0\n',
  })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /requires an explicit name/)
})

test('overlay validation errors name the overlay, not a merged index', async () => {
  const fx = await fixture({
    publicItems: ['pub-a', 'pub-b'],
    overlay: 'customizations:\n  - id: bad-type\n    type: nonsense\n',
  })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /local manifest overlay/)
  // Must not point at a merged position the public manifest does not have.
  assert.doesNotMatch(result.stderr, /customizations\[\d+\]/)
})

test('missing required field is rejected for overlay entries', async () => {
  // package requires version, exactly as in the public manifest.
  const fx = await fixture({
    overlay: 'customizations:\n  - id: no-version\n    type: package\n    source: local\n',
  })
  const result = fx.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /requires version/)
})

test('startup listing includes overlay entries', async () => {
  // A locally-installed customization that never appears in the startup list
  // would be "installed but invisible" — one half of the split state the spec
  // forbids. manifestNotes() is the brief/note projection that list is built on.
  const { manifestNotes } = await import('../scripts/plugin-list.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-localman-list-'))
  const manifestPath = path.join(root, 'dsh.yaml')
  await writeFile(manifestPath, 'dshVersion: 0.1.0-rc.7\ncustomizations: []\n')
  await writeFile(
    path.join(root, 'dsh.yaml.local'),
    'customizations:\n  - id: local-pkg\n    type: package\n    source: remote\n' +
    "    spec: '@scope/local-pkg@1.0.0'\n    version: 1.0.0\n    enabled: true\n" +
    '    brief: OVERLAY_BRIEF\n',
  )
  const notes = manifestNotes(manifestPath, root)
  assert.equal(notes.get('@scope/local-pkg'), 'OVERLAY_BRIEF')
  await rm(root, { recursive: true, force: true })
})

test('startup listing degrades instead of failing on a broken overlay', async () => {
  // Display surface: non-strict by design, mirroring the pre-existing tolerance
  // for an unreadable manifest. sync fails closed on this same input.
  const { manifestNotes } = await import('../scripts/plugin-list.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-localman-degrade-'))
  const manifestPath = path.join(root, 'dsh.yaml')
  await writeFile(manifestPath, 'dshVersion: 0.1.0-rc.7\nbundlesBrief:\n  keep-me: STILL_HERE\ncustomizations: []\n')
  await writeFile(path.join(root, 'dsh.yaml.local'), 'customizations:\n  - [unclosed\n')
  const notes = manifestNotes(manifestPath, root)
  assert.equal(notes.get('keep-me'), 'STILL_HERE')
  await rm(root, { recursive: true, force: true })
})

test('update check covers overlay remote entries', async () => {
  const { detectRemotePluginUpdates } = await import('../scripts/lib/plugin-updates.mjs')
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-localman-upd-'))
  const manifestPath = path.join(root, 'dsh.yaml')
  await writeFile(manifestPath, 'dshVersion: 0.1.0-rc.7\ncustomizations: []\n')
  await writeFile(
    path.join(root, 'dsh.yaml.local'),
    'customizations:\n  - id: overlay-remote\n    type: package\n    source: remote\n' +
    '    spec: definitely-not-a-real-package-xyz\n    version: 1.0.0\n    enabled: true\n',
  )
  const { rows } = await detectRemotePluginUpdates({ manifestPath, repo: root, dshVersion: '0.1.0-rc.7' })
  // Presence is the assertion: a non-npm spec is reported as skipped rather than
  // omitted, which still proves the entry entered the check at all.
  assert.ok(rows.some((row) => row.id === 'overlay-remote'), 'overlay entry must reach the update check')
  await rm(root, { recursive: true, force: true })
})

test('sync stays idempotent with an overlay present', async () => {
  const fx = await fixture({
    publicItems: ['pub-a'],
    overlay: 'customizations:\n  - id: local-only\n    type: patch\n    enabled: true\n',
    overlayPatchIds: ['local-only'],
  })
  const first = fx.run()
  assert.equal(first.status, 0, first.stderr)
  const second = fx.run()
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /no changes/)
})
