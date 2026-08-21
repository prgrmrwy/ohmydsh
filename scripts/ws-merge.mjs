#!/usr/bin/env node
// ohmydsh ws merge — the controlled path for merging a Worktree Session task
// branch into the main checkout.
//
// Why this exists: the ws runtime context forbids treating the main checkout
// as a scratch workspace (daily edits), but version-finalization (merging a
// task branch) is a required closure step that can only happen on the main
// checkout's refs. This script is the sanctioned exception: it verifies the
// merge is safe BEFORE touching anything, prints a plan, and only executes
// with an explicit `--yes` (user approval) — never a bare `git merge` from
// the agent.
//
// Usage:
//   node scripts/ws-merge.mjs <task-branch>             # dry-run: plan + gates
//   node scripts/ws-merge.mjs <task-branch> --yes       # execute (user approved)
//
// Gates (all must pass before ANY ref mutation):
//   1. task branch exists in the repository
//   2. main checkout is clean (no uncommitted changes)
//   3. merge is fast-forward OR a clean merge (no conflicts expected); the
//      script refuses to leave a conflicted tree behind
//   4. no worktree-session operation is in-flight (terminal prepared/cleaned are allowed)
//
// Exit code 0 on success (or dry-run with a viable plan); 1 on gate failure
// or refused execution without --yes.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const BRANCH = process.argv.find((a) => !a.startsWith('-') && process.argv.indexOf(a) > 1)
const YES = process.argv.includes('--yes')

if (BRANCH === undefined) {
  console.error('usage: node scripts/ws-merge.mjs <task-branch> [--yes]')
  process.exit(1)
}

/**
 * Resolve the main checkout path: the worktree whose git dir IS the common
 * dir (linked worktrees have their git dir under <common>/worktrees/<name>).
 * The merge always mutates the MAIN checkout, never the caller's worktree,
 * so REPO must be resolved from git state, not from the script location.
 */
function mainCheckoutPath() {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim()
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  let current = null
  for (const line of porcelain.split('\n')) {
    if (line === '') { current = null; continue }
    if (line.startsWith('worktree ')) {
      const candidate = line.slice('worktree '.length)
      try {
        const gitDir = execFileSync('git', ['-C', candidate, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim()
        if (path.resolve(gitDir) === path.resolve(common)) return candidate
      } catch { /* keep scanning */ }
    }
  }
  return undefined
}

const REPO = mainCheckoutPath()
if (REPO === undefined) {
  console.error('ws-merge FAILED: unable to resolve the main checkout path')
  process.exit(1)
}

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function gitOk(args, cwd = REPO) {
  try { execFileSync('git', args, { cwd, stdio: 'pipe' }); return true } catch { return false }
}

function mainCheckoutClean() {
  return git(['status', '--porcelain'], REPO) === ''
}

function branchExists(branch) {
  return gitOk(['rev-parse', '--verify', `refs/heads/${branch}`])
}

function inFlightOperations() {
  const common = git(['rev-parse', '--git-common-dir'])
  const dir = path.join(common, 'ws', 'operations')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
  }).filter(Boolean).filter((o) => o.phase !== 'prepared' && o.phase !== 'cleaned')
}

function main() {
  const gates = []
  if (!branchExists(BRANCH)) gates.push(`task branch "${BRANCH}" does not exist`)
  if (!mainCheckoutClean()) gates.push('main checkout is dirty (uncommitted changes)')
  const inFlight = inFlightOperations()
  if (inFlight.length > 0) gates.push(`in-flight ws operations: ${inFlight.map((o) => o.operationId).join(', ')}`)

  if (gates.length > 0) {
    console.error('ws-merge REFUSED:')
    for (const g of gates) console.error(`  - ${g}`)
    process.exit(1)
  }

  // Merge shape: prefer fast-forward; otherwise a real merge commit.
  const canFF = gitOk(['merge-base', '--is-ancestor', 'main', BRANCH])
  const head = git(['rev-parse', '--short', 'HEAD'])
  const tip = git(['rev-parse', '--short', BRANCH])
  console.log(`ws-merge plan (${YES ? 'EXECUTE' : 'dry-run'}):`)
  console.log(`  main       ${head}`)
  console.log(`  ${BRANCH}  ${tip}`)
  console.log(`  strategy:  ${canFF ? 'fast-forward' : 'merge commit'}`)

  if (!YES) {
    console.log('\nrun with --yes after user approval to execute (this mutates main checkout refs)')
    process.exit(0)
  }

  // Execute: ff if possible, otherwise a no-edit merge. On conflict we leave
  // nothing half-done: abort and report (never auto-resolve).
  if (canFF) {
    git(['merge', '--ff-only', BRANCH])
  } else {
    try {
      git(['merge', '--no-edit', '--no-ff', BRANCH])
    } catch {
      git(['merge', '--abort'])
      console.error('ws-merge FAILED: merge produced conflicts; aborted, nothing changed')
      process.exit(1)
    }
  }
  console.log(`ws-merge done: main -> ${git(['rev-parse', '--short', 'HEAD'])}`)
}

main()
