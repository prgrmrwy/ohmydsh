import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectLoadedPlugins } from '../scripts/plugin-list.mjs'

/**
 * Guard: the startup plugin list must report every plugin the profile really
 * loads, not just `dsh.profile.bundles`.
 *
 * DSH composes a profile from a patch stack (see @deepseek-ai/dsh/profile-boot
 * `composeProfile`): bundle layers, then the profile's own `cordis.patch.yml`,
 * then the home-level `$DSH_HOME/cordis.patch.yml`. A plugin that ships only
 * `dsh.client` (no `dsh.bundle`) is installed as a plain dependency and wired by
 * an explicit patch `insert` row — `dsh-width-tiers` via
 * `patches/width-tiers-wiring.yml` is exactly that shape. Reading only the
 * bundles array silently omitted it from the startup message for its whole life.
 *
 * The patch layer has a second shape that matters just as much: a top-level
 * `{id, name}` row with no `insert`, which re-wires the row carrying that id
 * instead of adding a new one. `patches/connection-webserver.yml` is that shape
 * under 0.1.5. The same "acted but invisible" defect applies, so both shapes are
 * asserted below.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function makeHome(profilePkg, profilePatch, homePatch) {
  const home = await mkdtemp(path.join(tmpdir(), 'ohmydsh-plugin-list-'))
  const profileDir = path.join(home, 'profiles', 'web')
  await mkdir(profileDir, { recursive: true })
  await writeFile(path.join(profileDir, 'package.json'), JSON.stringify(profilePkg))
  if (profilePatch !== undefined) await writeFile(path.join(profileDir, 'cordis.patch.yml'), profilePatch)
  if (homePatch !== undefined) await writeFile(path.join(home, 'cordis.patch.yml'), homePatch)
  return home
}

const bundlesPkg = (bundles) => ({ dsh: { profile: { bundles } } })

test('a patch-wired plugin is reported alongside the bundle layer', async (t) => {
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base', 'dsh-cost-meter']),
    ['- insert:', '    - id: dsh-width-tiers', '      name: dsh-width-tiers', ''].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const rows = collectLoadedPlugins({ dshHome: home, profile: 'web' })
  assert.deepEqual(rows, [
    { name: '@deepseek-ai/dsh-base', source: 'bundle' },
    { name: 'dsh-cost-meter', source: 'bundle' },
    { name: 'dsh-width-tiers', source: 'patch' },
  ])

  // Mutation check: the bundles-only reading is the defect this guards.
  const bundlesOnly = bundlesPkg(['@deepseek-ai/dsh-base', 'dsh-cost-meter']).dsh.profile.bundles
  assert.ok(!bundlesOnly.includes('dsh-width-tiers'), 'the defect must be reproducible')
})

test('the home-level patch layer is included too', async (t) => {
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    ['- insert:', '    - id: a', '      name: pkg-a', ''].join('\n'),
    ['- insert:', '    - id: b', '      name: pkg-b', ''].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const names = collectLoadedPlugins({ dshHome: home, profile: 'web' }).map((r) => r.name)
  assert.deepEqual(names, ['@deepseek-ai/dsh-base', 'pkg-a', 'pkg-b'])
})

test('patch files carrying !!js expressions still parse', async (t) => {
  // `!!js` is evaluated by the DSH loader, never here. A strict schema throws
  // "unknown tag" and would drop the whole patch layer — reintroducing the bug.
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    [
      '- id: better-sidebar',
      '  disabled: !!js >-',
      "    [...ctx.loader.entries()].some((e) => e.options.name === 'x')",
      '- insert:',
      '    - id: dsh-width-tiers',
      '      name: dsh-width-tiers',
      '',
    ].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const names = collectLoadedPlugins({ dshHome: home, profile: 'web' }).map((r) => r.name)
  assert.deepEqual(names, ['@deepseek-ai/dsh-base', 'dsh-width-tiers'])
})

test('disabled and duplicate insert rows are not reported as loaded', async (t) => {
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base', 'dsh-cost-meter']),
    [
      '- insert:',
      '    - id: off',
      '      name: pkg-off',
      '      disabled: true',
      '    - id: dup',
      '      name: dsh-cost-meter', // already loaded by the bundle layer
      '    - id: live',
      '      name: pkg-live',
      '- id: live',
      '  disabled: true', // a later row switches the inserted plugin back off
      '',
    ].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const names = collectLoadedPlugins({ dshHome: home, profile: 'web' }).map((r) => r.name)
  assert.deepEqual(names, ['@deepseek-ai/dsh-base', 'dsh-cost-meter'])
})

test('nested group inserts are collected', async (t) => {
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    [
      '- insert:',
      '    - id: g',
      '      name: group-pkg',
      '      group: true',
      '      config:',
      '        - id: inner',
      '          name: pkg-inner',
      '',
    ].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const names = collectLoadedPlugins({ dshHome: home, profile: 'web' }).map((r) => r.name)
  assert.deepEqual(names, ['@deepseek-ai/dsh-base', 'group-pkg', 'pkg-inner'])
})

test('a missing profile degrades to an empty list instead of throwing', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'ohmydsh-plugin-list-empty-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  assert.deepEqual(collectLoadedPlugins({ dshHome: home, profile: 'web' }), [])
})

test('an override row that re-wires an existing loader row is reported too', async (t) => {
  // The second wiring shape: a top-level `{id, name}` row with no `insert`.
  // It adds no loader row — it re-wires the row carrying that id. 0.1.5's
  // `patches/connection-webserver.yml` is exactly this, and it is load-bearing:
  // it is what gives the official `connection` row its `webServer` inject.
  // Reading only `insert` rows would hide it completely, which is the same
  // "patch layer acted, startup list shows nothing" defect this file guards.
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    [
      '- id: connection',
      "  name: '@deepseek-ai/dsh-client-connection'",
      '  inject: [webRuntime, webServer]',
      '',
    ].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const rows = collectLoadedPlugins({ dshHome: home, profile: 'web' })
  assert.deepEqual(rows, [
    { name: '@deepseek-ai/dsh-base', source: 'bundle' },
    { name: '@deepseek-ai/dsh-client-connection', source: 'patch' },
  ])
})

test('an override row marked disabled is not reported as loaded', async (t) => {
  // `disabled: true` on a top-level row means "drop the row carrying this id".
  // It contributes nothing, so it must not inflate the startup list.
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    ['- id: connection', "  name: '@deepseek-ai/dsh-client-connection'", '  disabled: true', ''].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const rows = collectLoadedPlugins({ dshHome: home, profile: 'web' })
  assert.deepEqual(rows, [{ name: '@deepseek-ai/dsh-base', source: 'bundle' }])
})

test('an override row naming an already-loaded bundle package does not duplicate it', async (t) => {
  const home = await makeHome(
    bundlesPkg(['@deepseek-ai/dsh-base']),
    ['- id: base-row', "  name: '@deepseek-ai/dsh-base'", '  config: {}', ''].join('\n'),
  )
  t.after(() => rm(home, { recursive: true, force: true }))

  const rows = collectLoadedPlugins({ dshHome: home, profile: 'web' })
  assert.deepEqual(rows, [{ name: '@deepseek-ai/dsh-base', source: 'bundle' }])
})

test('the CLI entry point still runs when the checkout is reached through a symlink', async (t) => {
  // The entry guard used to compare `import.meta.url` against a hand-built
  // `file://${process.argv[1]}`. Node resolves the main module's symlinks while
  // argv[1] keeps the caller's path, so on any checkout reached through a
  // symlink the comparison failed and `main()` never ran — exit 0, no output, no
  // error. `bin/dsh` consumes this script for both the startup message and the
  // startup-log plugin list, so the whole feature died silently there (44/44
  // devbox startup records read `plugins=[]`).
  //
  // Every other test here *imports* the module, which is exactly why none of
  // them noticed. This one runs it as a subprocess through a symlink.
  const home = await makeHome(bundlesPkg(['@deepseek-ai/dsh-base']))
  const linkRoot = await mkdtemp(path.join(tmpdir(), 'ohmydsh-plugin-list-symlink-'))
  t.after(() => rm(linkRoot, { recursive: true, force: true }))
  t.after(() => rm(home, { recursive: true, force: true }))

  const linkedRepo = path.join(linkRoot, 'repo')
  await symlink(REPO, linkedRepo, 'dir')

  const out = execFileSync(
    process.execPath,
    [path.join(linkedRepo, 'scripts', 'plugin-list.mjs'), '--names'],
    { env: { ...process.env, DSH_HOME: home, DSH_PROFILE: 'web' }, encoding: 'utf8' },
  )

  assert.match(out, /@deepseek-ai\/dsh-base/, 'the entry point must run through a symlinked path')
})

test('every manifest patch fragment this repo ships stays parseable', async (t) => {
  // The real fragments are the input the reader must survive; a fragment that
  // fails to parse would silently vanish from the startup list.
  //
  // Shipping zero fragments is a legitimate state rather than a coverage gap: a
  // fragment exists only while some plugin still needs hand-written wiring, and
  // retiring the last one is a goal, not a regression — dsh-width-tiers carried
  // its own bundle patch from 1.0.4 on, so `patches/width-tiers-wiring.yml` (the
  // only fragment this repo ever shipped) had to go, or the two id-less inserts
  // would have produced two loader rows for one plugin.
  //
  // The invariant guarded here is therefore conditional: whatever this repo
  // ships must parse AND be attributed to the patch layer. An empty patches/
  // skips, and protection returns automatically the moment a fragment is added
  // back. The reader itself stays covered unconditionally by the synthetic
  // fixtures above, so skipping here loses no coverage of the code under test.
  const { readFile, readdir } = await import('node:fs/promises')
  const dir = path.join(REPO, 'patches')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yml'))
  if (files.length === 0) {
    t.skip('this repo currently ships no patch fragments')
    return
  }

  const home = await makeHome(bundlesPkg([]), (await Promise.all(
    files.map(async (f) => (await readFile(path.join(dir, f), 'utf8')).trimEnd()),
  )).join('\n') + '\n')

  try {
    const rows = collectLoadedPlugins({ dshHome: home, profile: 'web' })
    assert.ok(rows.length > 0, 'shipped patch fragments must contribute loader rows')
    assert.ok(rows.every((r) => r.source === 'patch'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
