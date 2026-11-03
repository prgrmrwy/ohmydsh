'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, readFileSync, realpathSync, mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const here = __dirname

// Retired with the inquiry subsystem (locus-three-tier-structure, design 决策 11):
// these overlays must not be produced, applied, or required by the launcher graph.
const RETIRED_FILES = [
  'settlement-notice.patch',
  'package.template.json',
  'inquiry-isolation.patch',
  'newinquiry-tools-guard.patch',
  'native-managed-effects.patch',
  'native-tools.package.template.json',
  'newtools.package.template.json',
  'agent-loop.package.template.json',
  'verify-native-managed-effects.mjs',
  'verify-isolated-loop.mjs',
  'test-native-managed-effects.cjs',
  'test-native-owner-verifier.cjs',
]

test('retired overlays for agent-loop, tools and native tool owners are gone', () => {
  for (const name of RETIRED_FILES) assert.equal(existsSync(join(here, name)), false, `${name} must be removed`)
})

test('build and launcher wire only the team-membership overlay', () => {
  const build = readFileSync(join(here, 'build.mjs'), 'utf8')
  const launcher = readFileSync(join(here, 'build-launcher.cjs'), 'utf8')
  for (const source of [build, launcher]) {
    for (const retired of ['settlement-notice', 'inquiry-isolation', 'newinquiry-tools-guard', 'native-managed-effects', 'native-tools', 'newtools', 'agent-loop.package', 'verify-isolated-loop', 'verify-native-managed-effects', 'model-display']) {
      assert.doesNotMatch(source, new RegExp(retired), `retired reference ${retired} must not remain`)
    }
    assert.doesNotMatch(source, /'@deepseek-ai\/dsh-agent-loop': `file:/, 'agent-loop must not be overridden')
    assert.doesNotMatch(source, /'@deepseek-ai\/dsh-tools': `file:/, 'dsh-tools must not be overridden')
    assert.doesNotMatch(source, /dsh\.tool\.managed-effect/, 'native owner marker must not be produced')
  }
  assert.match(build, /team-membership\.patch/)
  assert.doesNotMatch(launcher, /'@deepseek-ai\/dsh-subagent': `file:/)
  assert.match(launcher, /verify-official-runtime\.mjs/)
  assert.match(launcher, /team-membership/)
})

test('both executables reject bad isolated arguments before touching formal launcher state', (t) => {
  const launcherPath = join(here, '.launcher')
  const before = (() => { try { return realpathSync(launcherPath) } catch { return null } })()
  const scratch = mkdtempSync(join(tmpdir(), 'compat-bad-args-'))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const cases = [['--isolated-output'], ['--isolated-output', 'relative'], ['--isolated-output', scratch, '--isolated-output', scratch], ['--isolated-output', scratch, '--unknown'], ['--unknown']]
  for (const script of ['build.mjs', 'build-launcher.cjs']) {
    for (const args of cases) {
      const result = spawnSync(process.execPath, [join(here, script), ...args], { cwd: here, encoding: 'utf8' })
      if (args.length === 0 && script === 'build-launcher.cjs') continue // legacy default is the formal build; never execute it.
      assert.equal(result.status, 2, `${script} ${args.join(' ')}: ${result.stderr}`)
    }
  }
  const after = (() => { try { return realpathSync(launcherPath) } catch { return null } })()
  assert.equal(after, before)
  assert.deepEqual(require('node:fs').readdirSync(scratch), [])
})

// Explicit artifact-plane gate: never falls back to a daily/formal launcher.
test('compiled launcher uses official retired owners and retained extensions', { skip: !process.env.PET_COMPAT_TEST_GRAPH }, () => {
  const result = spawnSync(process.execPath, [join(here, 'verify-official-runtime.mjs'), '--graph', process.env.PET_COMPAT_TEST_GRAPH], { cwd: here, encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
