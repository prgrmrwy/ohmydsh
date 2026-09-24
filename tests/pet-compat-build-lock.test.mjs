import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import test from 'node:test'

const SOURCE = path.resolve('packages/dsh-pet/compat/subagent/compat-build-lock.cjs')
let MODULE
let LOCK_DIR
let fixture
// Execute an exact source copy: never remove a real builder's lock during tests.
test.beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), 'pet-lock-test-'))
  MODULE = path.join(fixture, 'compat-build-lock.cjs')
  await copyFile(SOURCE, MODULE)
  LOCK_DIR = path.join(fixture, '.compat-build.lock')
})
test.afterEach(() => rm(fixture, { recursive: true, force: true }))

function child(log, holdMs) {
  const code = `
    const fs=require('node:fs');
    const {acquireCompatBuildLock}=require(${JSON.stringify(MODULE)});
    const lock=acquireCompatBuildLock({waitMs:5000,staleAfterMs:50});
    fs.appendFileSync(${JSON.stringify(log)}, 'enter '+process.pid+'\\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${holdMs});
    fs.appendFileSync(${JSON.stringify(log)}, 'exit '+process.pid+'\\n');
    lock.release();
  `
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['-e', code], { stdio: 'inherit' })
    processChild.once('error', reject)
    processChild.once('close', status => resolve(status))
  })
}

test('stale observation cannot reclaim a replacement directory before owner publication', async () => {
  await promisify(execFile)(process.execPath, [path.resolve('tests/fixtures/pet-lock-race.cjs'), MODULE], { timeout: 2_000 })
})

test('两个进程串行进入同一 compat 构建临界区', async t => {
  const log = path.join(fixture, 'lock.log')
  t.after(() => rm(log, { force: true }))
  const [a, b] = await Promise.all([child(log, 250), child(log, 50)])
  assert.equal(a, 0)
  assert.equal(b, 0)
  const lines = (await readFile(log, 'utf8')).trim().split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[0].split(' ')[0], 'enter')
  assert.equal(lines[1].split(' ')[0], 'exit')
  assert.equal(lines[2].split(' ')[0], 'enter')
  assert.equal(lines[3].split(' ')[0], 'exit')
})

test('死亡 owner 的 stale lock 可恢复', async () => {
  await mkdir(LOCK_DIR)
  await writeFile(path.join(LOCK_DIR, 'owner.json'), JSON.stringify({ pid: 99999999, token: 'dead' }))
  const old = new Date(Date.now() - 10_000)
  await utimes(LOCK_DIR, old, old)
  const { acquireCompatBuildLock } = await import(pathToFileURL(MODULE).href).then(module => module.default)
  const lock = acquireCompatBuildLock({ waitMs: 500, staleAfterMs: 10 })
  assert.equal(lock.owned, true)
  lock.release()
})

test('an ownerless directory is not death proof and cannot be automatically deleted', async () => {
  await mkdir(LOCK_DIR)
  const old = new Date(Date.now() - 10_000)
  await utimes(LOCK_DIR, old, old)
  const { acquireCompatBuildLock } = await import(pathToFileURL(MODULE).href).then(module => module.default)
  assert.throws(() => acquireCompatBuildLock({ waitMs: 0, staleAfterMs: 10 }), /timed out waiting/)
  await writeFile(path.join(LOCK_DIR, 'still-present'), 'yes')
})

test('abandoned reclamation claim respects the wait bound without unsafe claim deletion', async () => {
  await mkdir(LOCK_DIR)
  await writeFile(path.join(LOCK_DIR, 'owner.json'), JSON.stringify({ pid: 99999999, token: 'dead' }))
  await writeFile(`${LOCK_DIR}.reclaim-dead`, '')
  const old = new Date(Date.now() - 10_000)
  await utimes(LOCK_DIR, old, old)
  const code = `
    const assert = require('node:assert/strict');
    const { acquireCompatBuildLock } = require(${JSON.stringify(MODULE)});
    assert.throws(() => acquireCompatBuildLock({ waitMs: 0, staleAfterMs: 10 }), /timed out waiting/);
  `
  // An Atomics.wait loop blocks node:test timers. The parent must bound a
  // regressed child at the process level, not trust a same-thread timeout.
  await promisify(execFile)(process.execPath, ['-e', code], { timeout: 2_000 })
  assert.equal(await readFile(`${LOCK_DIR}.reclaim-dead`, 'utf8'), '')
})

test('两个 waiter 同时回收 stale lock 仍只有一个临界区 owner', async t => {
  await mkdir(LOCK_DIR)
  await writeFile(path.join(LOCK_DIR, 'owner.json'), JSON.stringify({ pid: 99999999, token: 'shared-dead' }))
  const old = new Date(Date.now() - 10_000)
  await utimes(LOCK_DIR, old, old)
  const log = path.join(fixture, 'stale.log')
  t.after(() => rm(log, { force: true }))
  const [a, b] = await Promise.all([child(log, 250), child(log, 50)])
  assert.equal(a, 0)
  assert.equal(b, 0)
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(line => line.split(' ')[0]), ['enter', 'exit', 'enter', 'exit'])
})
