// The compat builder reuses a 2.3 GB upstream checkout as a cache. On 2026-10-08
// the VM's cache had been built for 0.1.5; the 0.2 commit was present in it, so it
// was reused, and `git checkout -- .` left gitignored build output of packages that
// 0.2 deleted (settings-file/lib importing the removed SettingsProvider). The host
// runtime build then failed and DSH would not start. These tests pin the rule:
// a cache is reused only if it was last prepared for exactly the same inputs;
// otherwise every untracked and ignored file is removed before building.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const MODULE = path.resolve(import.meta.dirname, '..', 'packages', 'dsh-pet', 'compat', 'subagent', 'upstream-cache.cjs')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** A real git checkout with one tracked file, an ignored build output, and an untracked stray. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'compat-cache-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@t'); git(root, 'config', 'user.name', 't')
  writeFileSync(path.join(root, '.gitignore'), 'lib/\nnode_modules/\n')
  mkdirSync(path.join(root, 'packages', 'kept'), { recursive: true })
  writeFileSync(path.join(root, 'packages', 'kept', 'index.ts'), 'export const kept = 1\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const commit = git(root, 'rev-parse', 'HEAD')
  // Leftovers of a package the new upstream deleted: gitignored build output.
  const stale = path.join(root, 'packages', 'removed', 'lib', 'index.js')
  mkdirSync(path.dirname(stale), { recursive: true })
  writeFileSync(stale, "import { SettingsProvider } from '../settings/src/index.ts'\n")
  const stray = path.join(root, 'stray.txt')
  writeFileSync(stray, 'untracked\n')
  return { root, commit, stale, stray, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('a cache prepared for different inputs is scrubbed of ignored and untracked files', () => {
  const { prepareUpstreamCache } = require(MODULE)
  const f = fixture()
  try {
    // No stamp yet: exactly the VM situation (cache left by an earlier build).
    const outcome = prepareUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1', run: (cmd, args, cwd) => execFileSync(cmd, args, { cwd }) })
    assert.equal(outcome.reused, false)
    assert.equal(existsSync(f.stale), false, 'stale ignored build output of a deleted package must be removed')
    assert.equal(existsSync(f.stray), false, 'untracked files must be removed')
    assert.equal(readFileSync(path.join(f.root, 'packages', 'kept', 'index.ts'), 'utf8'), 'export const kept = 1\n', 'tracked source is kept')
  } finally { f.cleanup() }
})

test('a cache prepared for the same inputs is reused and keeps its build output', () => {
  const { prepareUpstreamCache, recordUpstreamCache } = require(MODULE)
  const f = fixture()
  try {
    const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd })
    recordUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1' })
    const outcome = prepareUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1', run })
    assert.equal(outcome.reused, true)
    assert.equal(existsSync(f.stale), true, 'matching inputs: ignored output (e.g. node_modules) is reused, not rebuilt')
  } finally { f.cleanup() }
})

test('a changed patch or commit invalidates the cache even when a stamp exists', () => {
  const { prepareUpstreamCache, recordUpstreamCache } = require(MODULE)
  for (const changed of [{ patchSha256: 'p2' }, { commit: 'deadbeef' }]) {
    const f = fixture()
    try {
      recordUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1' })
      const outcome = prepareUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1', ...changed, run: (cmd, args, cwd) => execFileSync(cmd, args, { cwd }) })
      assert.equal(outcome.reused, false, JSON.stringify(changed))
      assert.equal(existsSync(f.stale), false, JSON.stringify(changed))
    } finally { f.cleanup() }
  }
})

test('the stamp survives the scrub and lives outside the git work tree contents', () => {
  const { prepareUpstreamCache, recordUpstreamCache, stampPath } = require(MODULE)
  const f = fixture()
  try {
    const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd })
    prepareUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1', run })
    recordUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1' })
    // Inside .git: git clean never touches it and it never shows as an untracked file.
    assert.ok(stampPath(f.root).startsWith(path.join(f.root, '.git') + path.sep))
    // After the scrub the tree holds no untracked or ignored files at all (the stamp is inside .git).
    assert.equal(git(f.root, 'status', '--porcelain', '--ignored'), '', 'scrubbed tree has no strays')
    assert.equal(prepareUpstreamCache({ checkout: f.root, commit: f.commit, patchSha256: 'p1', run }).reused, true)
  } finally { f.cleanup() }
})

test('build.mjs consults the cache stamp before building and records it only after a successful build', () => {
  const builder = readFileSync(path.resolve(import.meta.dirname, '..', 'packages', 'dsh-pet', 'compat', 'subagent', 'build.mjs'), 'utf8')
  const prepare = builder.indexOf('prepareUpstreamCache(')
  const apply = builder.indexOf("run('git', ['apply', patchFile], checkout)")
  const record = builder.indexOf('recordUpstreamCache(')
  const published = builder.indexOf("writeFileSync(join(target, 'package.json')")
  assert.ok(prepare > 0 && apply > 0 && record > 0 && published > 0, 'all markers present')
  assert.ok(prepare < apply, 'cache is prepared before the patch is applied')
  assert.ok(record > published, 'stamp is written only after the artifact is published')
})
