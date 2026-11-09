import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/mirror-sync.mjs', import.meta.url))
const PREFIX = 'packages/pkg'
// git subtree is a POSIX shell script; the native Windows lane runs without a shell.
const skip = process.platform === 'win32' ? 'git subtree needs a POSIX shell' : false

const env = { ...process.env, GIT_AUTHOR_NAME: 'maint', GIT_AUTHOR_EMAIL: 'm@example.invalid',
  GIT_COMMITTER_NAME: 'maint', GIT_COMMITTER_EMAIL: 'm@example.invalid', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
function run(cwd, cmd, argv, extra = {}) {
  const result = spawnSync(cmd, argv, { cwd, encoding: 'utf8', env: { ...env, ...extra } })
  return { status: result.status, out: result.stdout.trim(), err: result.stderr.trim() }
}
function git(cwd, ...argv) {
  const result = run(cwd, 'git', argv)
  assert.equal(result.status, 0, `git ${argv.join(' ')}: ${result.err}`)
  return result.out
}
function commit(cwd, file, text, message, author) {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  writeFileSync(path.join(cwd, file), text)
  git(cwd, 'add', file)
  const result = run(cwd, 'git', ['commit', '-qm', message], author ? { GIT_AUTHOR_NAME: author } : {})
  assert.equal(result.status, 0, result.err)
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'mirror-sync-'))
  const origin = path.join(root, 'origin.git'), mirror = path.join(root, 'mirror.git')
  const mono = path.join(root, 'mono'), contrib = path.join(root, 'contrib')
  git(root, 'init', '-q', '--bare', '-b', 'main', origin)
  git(root, 'init', '-q', '--bare', '-b', 'main', mirror)
  git(root, 'clone', '-q', origin, mono)
  git(mono, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  commit(mono, 'README.md', 'mono\n', 'chore: root')
  commit(mono, `${PREFIX}/index.js`, 'one\n', 'feat(pkg): one')
  commit(mono, 'other/x.txt', 'x\n', 'chore: unrelated')
  commit(mono, `${PREFIX}/index.js`, 'one\ntwo\n', 'feat(pkg): two')
  git(mono, 'push', '-q', 'origin', 'main')
  // The one-way mirror as it exists today: a plain split pushed to the mirror.
  const first = git(mono, 'subtree', 'split', `--prefix=${PREFIX}`, 'HEAD').split('\n').at(-1)
  git(mono, 'push', '-q', mirror, `${first}:refs/heads/main`)
  git(root, 'clone', '-q', mirror, contrib)
  const sync = (...extra) => run(mono, process.execPath, [SCRIPT, '--prefix', PREFIX, '--mirror', mirror, '--push-origin', ...extra])
  const mirrorMain = () => git(root, '--git-dir', mirror, 'rev-parse', 'main')
  const originMain = () => git(root, '--git-dir', origin, 'rev-parse', 'main')
  const contribute = (file, text, message) => {
    git(contrib, 'pull', '-q', '--ff-only', 'origin', 'main')
    commit(contrib, file, text, message, 'contributor')
    git(contrib, 'push', '-q', 'origin', 'HEAD:main')
    return git(contrib, 'rev-parse', 'HEAD')
  }
  return { root, mono, mirror, first, sync, mirrorMain, originMain, contribute, done: () => rmSync(root, { recursive: true, force: true }) }
}

test('first run joins histories without changing files or the mirror, then is idempotent', { skip }, () => {
  const f = fixture()
  try {
    const tree = git(f.mono, 'rev-parse', 'HEAD^{tree}')
    const result = f.sync()
    assert.equal(result.status, 0, result.err)
    assert.equal(result.out, f.first)
    assert.equal(f.mirrorMain(), f.first)
    assert.equal(git(f.mono, 'rev-parse', 'HEAD^{tree}'), tree)
    assert.match(git(f.mono, 'log', '-1', '--format=%s'), /join pkg mirror history/)
    assert.equal(f.originMain(), git(f.mono, 'rev-parse', 'HEAD'))
    const head = f.originMain()
    assert.equal(f.sync().status, 0)
    assert.equal(f.originMain(), head)
    assert.equal(f.mirrorMain(), f.first)
  } finally { f.done() }
})

test('first run with unsynced monorepo package commits joins at the mirror and fast-forwards it', { skip }, () => {
  const f = fixture()
  try {
    commit(f.mono, `${PREFIX}/new.js`, 'new\n', 'feat(pkg): change not yet on the mirror')
    const result = f.sync()
    assert.equal(result.status, 0, result.err)
    assert.equal(git(f.mono, 'merge-base', '--is-ancestor', f.first, result.out), '')
    assert.notEqual(result.out, f.first)
    assert.equal(f.mirrorMain(), result.out)
    assert.equal(git(f.mono, 'rev-parse', `${result.out}^{tree}`), git(f.mono, 'rev-parse', `HEAD:${PREFIX}`))
    // later mirror PRs still merge back after this kind of join
    const pr = f.contribute('index.js', 'one\ntwo\nthree\n', 'fix: after join')
    const next = f.sync()
    assert.equal(next.status, 0, next.err)
    assert.equal(next.out, pr)
  } finally { f.done() }
})

test('a PR merged on the mirror is merged back and keeps its SHA, authorship and fast-forward', { skip }, () => {
  const f = fixture()
  try {
    assert.equal(f.sync().status, 0)
    const pr = f.contribute('index.js', 'one\ntwo\nthree\n', 'fix: contributor change')
    const result = f.sync()
    assert.equal(result.status, 0, result.err)
    assert.equal(result.out, pr)
    assert.equal(readFileSync(path.join(f.mono, PREFIX, 'index.js'), 'utf8'), 'one\ntwo\nthree\n')
    assert.equal(f.originMain(), git(f.mono, 'rev-parse', 'HEAD'))
    commit(f.mono, `${PREFIX}/extra.js`, 'mono\n', 'feat(pkg): mono side')
    const next = f.sync()
    assert.equal(next.status, 0, next.err)
    assert.equal(git(f.mono, 'merge-base', '--is-ancestor', pr, next.out), '')
    assert.equal(f.mirrorMain(), next.out)
    assert.equal(git(f.mono, 'log', '-1', '--format=%an', pr), 'contributor')
  } finally { f.done() }
})

test('changes on both sides to different files merge and fast-forward the mirror', { skip }, () => {
  const f = fixture()
  try {
    assert.equal(f.sync().status, 0)
    commit(f.mono, `${PREFIX}/mono.txt`, 'm\n', 'feat(pkg): unsynced mono change')
    const pr = f.contribute('contrib.txt', 'c\n', 'feat: contributor file')
    const result = f.sync()
    assert.equal(result.status, 0, result.err)
    assert.equal(git(f.mono, 'merge-base', '--is-ancestor', pr, result.out), '')
    assert.equal(git(f.mono, 'rev-parse', `${result.out}^{tree}`), git(f.mono, 'rev-parse', `HEAD:${PREFIX}`))
  } finally { f.done() }
})

test('a conflicting edit fails, pushes nothing and leaves the checkout clean', { skip }, () => {
  const f = fixture()
  try {
    assert.equal(f.sync().status, 0)
    const before = { origin: f.originMain(), mirror: f.mirrorMain() }
    commit(f.mono, `${PREFIX}/index.js`, 'mono edit\n', 'fix(pkg): mono edit')
    const head = git(f.mono, 'rev-parse', 'HEAD')
    f.contribute('index.js', 'mirror edit\n', 'fix: mirror edit')
    const result = f.sync()
    assert.notEqual(result.status, 0)
    assert.match(result.err, /conflicts; merge it by hand/)
    assert.equal(git(f.mono, 'rev-parse', 'HEAD'), head)
    assert.equal(git(f.mono, 'status', '--porcelain'), '')
    assert.equal(f.originMain(), before.origin)
    assert.notEqual(f.mirrorMain(), before.mirror) // the contributor's push, untouched by the sync
  } finally { f.done() }
})
