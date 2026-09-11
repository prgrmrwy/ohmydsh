import assert from 'node:assert/strict'
import { mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const MODULE = path.resolve('packages/dsh-pet/compat/subagent/compat-build-lock.cjs')
const { LOCK_DIR } = await import(MODULE).then(module => module.default)

test.beforeEach(() => rm(LOCK_DIR, { recursive: true, force: true }))
test.afterEach(() => rm(LOCK_DIR, { recursive: true, force: true }))

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

test('两个进程串行进入同一 compat 构建临界区', async t => {
  const log = path.resolve(`.tmp-pet-compat-lock-${process.pid}.log`)
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
  const { acquireCompatBuildLock } = await import(MODULE).then(module => module.default)
  const lock = acquireCompatBuildLock({ waitMs: 500, staleAfterMs: 10 })
  assert.equal(lock.owned, true)
  lock.release()
})

test('两个 waiter 同时回收 stale lock 仍只有一个临界区 owner', async t => {
  await mkdir(LOCK_DIR)
  await writeFile(path.join(LOCK_DIR, 'owner.json'), JSON.stringify({ pid: 99999999, token: 'shared-dead' }))
  const old = new Date(Date.now() - 10_000)
  await utimes(LOCK_DIR, old, old)
  const log = path.resolve(`.tmp-pet-compat-stale-${process.pid}.log`)
  t.after(() => rm(log, { force: true }))
  const [a, b] = await Promise.all([child(log, 250), child(log, 50)])
  assert.equal(a, 0)
  assert.equal(b, 0)
  assert.deepEqual((await readFile(log, 'utf8')).trim().split('\n').map(line => line.split(' ')[0]), ['enter', 'exit', 'enter', 'exit'])
})
