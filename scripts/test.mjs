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
  return ['package-manager', 'launcher-bootstrap', 'launcher-exec', 'launcher-args', 'launcher-env-local', 'launcher-environment', 'launcher-process', 'launcher-ui', 'launcher-runner', 'launcher-lifecycle', 'launcher-install', 'launcher-acceptance', 'workspace-lifecycle', 'test-driver'].map(name => path.join('tests', `${name}.test.mjs`)).concat(path.join('tests', 'platform', 'windows-launcher.test.mjs'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A fresh root's absent path masks both exported and checkout-local overlays.
  const isolation = mkdtempSync(path.join(os.tmpdir(), 'ohmydsh-test-isolation-'))
  const tests = testFiles(process.platform, readdirSync('tests'))
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...tests], { stdio: 'inherit', env: { ...process.env, DSH_LOCAL_MANIFEST: path.join(isolation, 'absent.yaml') } })
  process.exitCode = result.status ?? 1
}
