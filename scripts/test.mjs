#!/usr/bin/env node
import { readdirSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export function testFiles(platform, entries) {
  if (platform !== 'win32') return entries.filter(name => name.endsWith('.test.mjs')).sort().map(name => path.join('tests', name))
  // Historical Bash oracle fixtures stay in the complete POSIX lane. Native
  // Windows never starts them or silently skips a failed platform assertion.
  return ['child-process', 'package-manager', 'launcher-bootstrap', 'launcher-exec', 'launcher-args', 'launcher-env-local', 'launcher-environment', 'launcher-process', 'launcher-ui', 'launcher-runner', 'launcher-lifecycle', 'launcher-install', 'launcher-acceptance', 'workspace-lifecycle', 'skill-execution', 'test-driver'].map(name => path.join('tests', `${name}.test.mjs`)).concat(path.join('tests', 'platform', 'windows-launcher.test.mjs'))
}

export function testBuildWorkspaces(tests) {
  const workspaces = []
  if (tests.includes(path.join('tests', 'dsh-openspec-upgrade.test.mjs'))) workspaces.push('dsh-openspec')
  if (tests.includes(path.join('tests', 'settings-navigation-icons.test.mjs'))) {
    workspaces.push('dsh-pet', 'dsh-memex', 'dsh-magpie-connector', 'dsh-auto-model-routing')
  }
  return workspaces
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A fresh root's absent path masks both exported and checkout-local overlays.
  const isolation = mkdtempSync(path.join(os.tmpdir(), 'ohmydsh-test-isolation-'))
  const tests = testFiles(process.platform, readdirSync('tests'))
  // Runtime integration tests load gitignored bundles; build them on fresh checkouts too.
  for (const workspace of testBuildWorkspaces(tests)) {
    const build = spawnSync('npm', ['run', 'build', '--workspace', workspace], { stdio: 'inherit' })
    if (build.status !== 0) { process.exitCode = build.status ?? 1; process.exit() }
  }
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...tests], { stdio: 'inherit', env: { ...process.env, DSH_LOCAL_MANIFEST: path.join(isolation, 'absent.yaml') } })
  process.exitCode = result.status ?? 1
}
