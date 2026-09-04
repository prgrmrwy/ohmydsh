import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

test('every manifest patch fragment this repo ships stays parseable', async () => {
  // The real fragments are the input the reader must survive; a fragment that
  // fails to parse would silently vanish from the startup list.
  const { readFile, readdir } = await import('node:fs/promises')
  const dir = path.join(REPO, 'patches')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.yml'))
  assert.ok(files.length > 0, 'expected at least one patch fragment')

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
