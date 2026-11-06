import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/ws-merge.mjs')
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-merge-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8' }).trim()
  const write = (file, text) => fs.writeFileSync(path.join(dir, file), text)
  git('init', '-q', '-b', 'main')
  write('a.txt', 'base\n'); write('b.txt', 'base\n'); git('add', '.'); git('commit', '-q', '-m', 'base')
  return { dir, git, write }
}
const run = (dir, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8' })

test('conflicting task branch is refused in dry-run and execute, main untouched', t => {
  const r = repo(t)
  r.git('checkout', '-q', '-b', 'ws/task'); r.write('a.txt', 'task\n'); r.git('commit', '-qam', 'task')
  r.git('checkout', '-q', 'main'); r.write('a.txt', 'main\n'); r.git('commit', '-qam', 'main')
  const before = r.git('rev-parse', 'main')
  for (const args of [['ws/task'], ['ws/task', '--yes']]) {
    const res = run(r.dir, ...args)
    assert.equal(res.status, 1, args.join(' '))
    assert.match(res.stderr, /conflict/i)
    assert.match(res.stderr, /a\.txt/)
  }
  assert.equal(r.git('rev-parse', 'main'), before)
  assert.equal(r.git('status', '--porcelain'), '')
})

test('clean non-fast-forward branch still plans and executes a merge commit', t => {
  const r = repo(t)
  r.git('checkout', '-q', '-b', 'ws/task'); r.write('a.txt', 'task\n'); r.git('commit', '-qam', 'task')
  r.git('checkout', '-q', 'main'); r.write('b.txt', 'main\n'); r.git('commit', '-qam', 'main')
  const dry = run(r.dir, 'ws/task')
  assert.equal(dry.status, 0, dry.stderr)
  assert.match(dry.stdout, /merge commit/)
  const exec = run(r.dir, 'ws/task', '--yes')
  assert.equal(exec.status, 0, exec.stderr)
  assert.equal(fs.readFileSync(path.join(r.dir, 'a.txt'), 'utf8'), 'task\n')
})
