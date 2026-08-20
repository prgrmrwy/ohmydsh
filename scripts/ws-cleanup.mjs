#!/usr/bin/env node
// ohmydsh ws cleanup — scan git worktrees against the ws operation registry
// (.git/ws/operations/*.json) and remove the ones that are safe to clean.
//
// Why this exists: ws has no batch-clean command (clean is per-operation, and
// the agent-facing ws tool only resolves the calling session's own binding).
// This script lets an agent in the main checkout (full access) scan ALL
// worktrees, apply the same safety gates wsClean enforces (not active, not
// dirty, branch merged into base, no in-flight operation), and remove the
// safe ones — with a dry-run default.
//
// Usage:
//   node scripts/ws-cleanup.mjs            # dry-run: list candidates + reasons
//   node scripts/ws-cleanup.mjs --apply    # actually remove safe worktrees
//   node scripts/ws-cleanup.mjs --path <worktree> [--apply]   # one target
//
// Exit code 0 even when nothing was cleaned; non-zero only on script errors.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')
const PATH_ARG = process.argv.indexOf('--path')
const TARGET = PATH_ARG !== -1 ? path.resolve(process.argv[PATH_ARG + 1] ?? '') : undefined

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function gitOk(args, cwd = REPO) {
  try { execFileSync('git', args, { cwd, stdio: 'pipe' }); return true } catch { return false }
}

function worktreeList() {
  // porcelain: blank-line-separated records; "worktree <path>" then "branch <ref>" etc.
  const out = git(['worktree', 'list', '--porcelain'])
  const records = []
  let current = null
  for (const line of out.split('\n')) {
    if (line === '') { current = null; continue }
    if (line.startsWith('worktree ')) { current = { path: line.slice('worktree '.length) }; records.push(current) }
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line.startsWith('detached')) current.detached = true
  }
  return records
}

function operationRegistry() {
  const common = git(['rev-parse', '--git-common-dir'])
  const dir = path.join(common, 'ws', 'operations')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
  }).filter(Boolean)
}

/** Session-id → cwd mapping from the DSH sessions directory, when available. */
function activeSessionCwds() {
  const home = process.env.DSH_HOME ?? path.join(process.env.HOME ?? '', '.dsh')
  const sessionsDir = path.join(home, 'sessions')
  if (!existsSync(sessionsDir)) return new Set()
  const set = new Set()
  for (const workspaceDir of readdirSync(sessionsDir)) {
    const dir = path.join(sessionsDir, workspaceDir)
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      const jsonl = path.join(dir, entry, 'session.jsonl')
      if (!existsSync(jsonl)) continue
      // cwd is recorded in the first user message header; approximate with
      // the file's own directory name (workspace-encoded) — conservative:
      // we only use it to EXCLUDE worktrees that look actively used.
      set.add(entry)
    }
  }
  return set
}

function isMainCheckout(targetPath) {
  // The main checkout's absolute git dir IS the common dir; linked worktrees
  // resolve their git dir under <common>/worktrees/<name> instead.
  const common = git(['rev-parse', '--git-common-dir'])
  try {
    const gitDir = execFileSync('git', ['-C', targetPath, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim()
    return path.resolve(gitDir) === path.resolve(common)
  } catch {
    return false
  }
}

function isCurrentExecutionRoot(targetPath) {
  // The caller's cwd (an agent in the main checkout) must not be inside the target.
  const cwd = path.resolve(process.cwd())
  return cwd === targetPath || cwd.startsWith(targetPath + path.sep)
}

function branchMergedIntoBase(branch, baseRef) {
  if (branch === undefined || branch === '') return false
  return gitOk(['merge-base', '--is-ancestor', branch, baseRef])
}

function worktreeDirty(targetPath) {
  return git(['status', '--porcelain'], targetPath) !== ''
}

function main() {
  const ops = operationRegistry()
  const byPath = new Map(ops.filter((o) => o.worktreePath).map((o) => [path.resolve(o.worktreePath), o]))
  const activeCwds = activeSessionCwds()
  const baseRef = 'main'
  const results = []

  for (const wt of worktreeList()) {
    const target = path.resolve(wt.path)
    if (isMainCheckout(target)) continue // the main checkout itself
    if (TARGET !== undefined && target !== TARGET) continue

    const reasons = []
    const op = byPath.get(target)

    // Gate 1: never remove the caller's own execution root.
    if (isCurrentExecutionRoot(target)) reasons.push('current execution root (cwd inside)')
    // Gate 2: never remove a worktree of an operation that is not prepared (in-flight).
    if (op !== undefined && op.phase !== 'prepared') reasons.push(`operation phase=${op.phase}`)
    // Gate 3: never remove a worktree with uncommitted changes.
    try { if (worktreeDirty(target)) reasons.push('dirty worktree') } catch { reasons.push('not a git worktree?') }
    // Gate 4: the task branch must be proven merged into the base ref.
    if (!branchMergedIntoBase(wt.branch, baseRef)) reasons.push(`branch ${wt.branch ?? '(detached)'} not merged into ${baseRef}`)
    // Gate 5: a source-session binding whose session is still active is not removable.
    if (op?.binding?.mode === 'source-session') {
      const sid = op.binding.sourceSessionId
      if (sid !== undefined && activeCwds.has(sid)) reasons.push(`bound to active source session ${sid}`)
    }

    results.push({ target, branch: wt.branch, op: op?.operationId, reasons })
  }

  const cleanable = results.filter((r) => r.reasons.length === 0)
  const blocked = results.filter((r) => r.reasons.length > 0)

  console.log(`ws cleanup scan (${APPLY ? 'APPLY' : 'dry-run'}), base=${baseRef}`)
  console.log(`operations in registry: ${ops.length}, worktrees scanned: ${results.length}`)
  if (cleanable.length === 0) console.log('no cleanable worktrees')

  for (const r of cleanable) {
    console.log(`\nREMOVE ${r.target}  (branch ${r.branch ?? 'detached'}, op ${r.op ?? 'unregistered'})`)
    if (APPLY) {
      git(['worktree', 'remove', r.target])
      if (r.branch) git(['branch', '-d', r.branch])
      console.log('  -> removed')
    }
  }
  for (const r of blocked) {
    console.log(`\nKEEP   ${r.target}  (${r.reasons.join('; ')})`)
  }

  if (TARGET !== undefined && !results.some((r) => r.target === TARGET)) {
    console.log(`\nnote: --path ${TARGET} matched no worktree`)
    process.exitCode = 1
  }
}

main()
