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
  return ['child-process', 'compat-launcher-policy', 'compat-launcher-publish', 'dsh-host-runtime', 'package-manager', 'launcher-bootstrap', 'launcher-exec', 'launcher-args', 'launcher-env-local', 'launcher-environment', 'launcher-process', 'launcher-ui', 'launcher-runner', 'launcher-lifecycle', 'launcher-install', 'launcher-acceptance', 'workspace-lifecycle', 'test-driver'].map(name => path.join('tests', `${name}.test.mjs`)).concat(path.join('tests', 'platform', 'windows-launcher.test.mjs'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A fresh root's absent path masks both exported and checkout-local overlays.
  const isolation = mkdtempSync(path.join(os.tmpdir(), 'ohmydsh-test-isolation-'))
  const tests = testFiles(process.platform, readdirSync('tests'))
  // tests/dsh-openspec-upgrade imports the gitignored packages/dsh-openspec/lib;
  // build it here so a fresh checkout or worktree is not ERR_MODULE_NOT_FOUND.
  if (tests.includes(path.join('tests', 'dsh-openspec-upgrade.test.mjs'))) {
    const build = spawnSync('npm', ['run', 'build', '--workspace', 'dsh-openspec'], { stdio: 'inherit' })
    if (build.status !== 0) { process.exitCode = build.status ?? 1; process.exit() }
  }
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...tests], { stdio: 'inherit', env: { ...process.env, DSH_LOCAL_MANIFEST: path.join(isolation, 'absent.yaml') } })
  process.exitCode = result.status ?? 1
}
