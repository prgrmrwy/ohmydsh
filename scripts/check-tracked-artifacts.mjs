#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const REQUIRED_TRACKED_PATHS = [
  'package-lock.json',
  'archify-out/ohmydsh-architecture.json',
  'archify-out/ohmydsh-architecture.dual.svg',
]

export function artifactPolicyViolations(files) {
  const violations = []
  for (const original of files) {
    const file = original.split(path.sep).join('/')
    if (/^packages\/[^/]+\/lib\//.test(file)) violations.push(`${file}: generated package lib must not be tracked`)
    if (/^packages\/[^/]+\/package-lock\.json$/.test(file)) violations.push(`${file}: nested package lock must not be tracked`)
    if (/^openspec\/changes\/.+\/checking\/(baselines|screenshots)\//.test(file)) violations.push(`${file}: raw acceptance evidence must not be tracked`)
    if (/^archify-out\/.*\.(png|html)$/.test(file)) violations.push(`${file}: duplicate architecture export must not be tracked`)
    if (file === 'worktree-session-architecture.html') violations.push(`${file}: generated architecture HTML must not be tracked`)
  }
  const set = new Set(files.map((file) => file.split(path.sep).join('/')))
  for (const required of REQUIRED_TRACKED_PATHS) {
    if (!set.has(required)) violations.push(`${required}: required architecture/lock source is not tracked`)
  }
  return violations
}

export function trackedFiles(cwd = REPO) {
  const result = spawnSync('git', ['ls-files'], { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'git ls-files failed')
  return result.stdout.split('\n').filter(Boolean)
}

function main() {
  for (const required of REQUIRED_TRACKED_PATHS) {
    if (!existsSync(path.join(REPO, required))) {
      console.error(`[artifacts] ERROR required file missing from working tree: ${required}`)
      process.exitCode = 1
    }
  }
  const violations = artifactPolicyViolations(trackedFiles())
  if (violations.length > 0) {
    console.error(`[artifacts] ${violations.length} tracked artifact policy violation(s):`)
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exitCode = 1
    return
  }
  console.log('[artifacts] tracked paths comply with repository policy')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
