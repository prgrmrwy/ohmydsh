import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { sessionEvidence, withoutSessionMarkers, detachCommand, scheduleRestart, orchestrateRestart, restartHistory, receiptPath } from '../scripts/launcher/session-restart.mjs'
import { runLauncher } from '../scripts/launcher/main.mjs'

const tmpHome = t => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-session-restart-')); t.after(() => fs.rmSync(home, { recursive: true, force: true })); return home }
const receipts = home => fs.readFileSync(receiptPath(home), 'utf8').trim().split('\n').map(line => JSON.parse(line))
const quiet = { log: () => {}, warn: () => {} }

test('session evidence: Host-managed cgroup ranges, then markers', () => {
  const cgroup = name => () => `0::/user.slice/user@1000.service/app.slice/${name}\n`
  assert.deepEqual(sessionEvidence({ platform: 'linux', env: {}, readCgroup: cgroup('dsh-subprocess-2313-64cf340d27f3.scope') }), { kind: 'cgroup', detail: 'dsh-subprocess-2313-64cf340d27f3.scope' })
  assert.equal(sessionEvidence({ platform: 'linux', env: {}, readCgroup: cgroup('dsh-terminal-9-abcdef012345.scope') }).kind, 'cgroup')
  // A restart scope created by this launcher is not a Host range.
  assert.equal(sessionEvidence({ platform: 'linux', env: {}, readCgroup: cgroup('dsh-restart-20261029-1-abc.scope') }), undefined)
  assert.equal(sessionEvidence({ platform: 'linux', env: { DSH_SHELL: '1' }, readCgroup: () => { throw new Error('EACCES') } }).kind, 'marker')
  assert.equal(sessionEvidence({ platform: 'darwin', env: { DSH_SESSION_ID: 's1' } }).detail, 'DSH_SESSION_ID')
  assert.equal(sessionEvidence({ platform: 'darwin', env: {} }), undefined)
  assert.equal(sessionEvidence({ platform: 'linux', env: {}, readCgroup: cgroup('user.slice') }), undefined)
})

test('the external test override needs node --test and cannot hide a real agent env otherwise', () => {
  assert.equal(sessionEvidence({ platform: 'darwin', env: { DSH_SHELL: '1', DSH_RESTART_CONTEXT: 'external' } }).kind, 'marker')
  assert.equal(sessionEvidence({ platform: 'darwin', env: { DSH_SHELL: '1', DSH_RESTART_CONTEXT: 'external', NODE_TEST_CONTEXT: 'child' } }), undefined)
})

test('session markers and protocol variables never reach the replacement', () => {
  assert.deepEqual(withoutSessionMarkers({ DSH_HOME: '/h', DSH_SHELL: '1', DSH_SESSION_ID: 's', DSH_WEB_URL: 'u', DSH_PTY_SESSION_ID: 'p', DSH_RESTART_NONCE: 'n', DSH_TELEMETRY_DISABLED: '1', PATH: '/bin' }), { DSH_HOME: '/h', DSH_TELEMETRY_DISABLED: '1', PATH: '/bin' })
})

test('detach uses a fresh systemd scope only when the Host owns a scope', () => {
  const base = { execPath: '/node', script: '/repo/bin/dsh.mjs', argv: ['restart', '--no-open'], restartId: 'r1' }
  assert.deepEqual(detachCommand({ ...base, evidence: { kind: 'cgroup' } }), ['systemd-run', ['--user', '--scope', '--quiet', '--collect', '--unit=dsh-restart-r1', '--', '/node', '/repo/bin/dsh.mjs', 'restart', '--no-open']])
  assert.deepEqual(detachCommand({ ...base, evidence: { kind: 'marker' } }), ['/node', ['/repo/bin/dsh.mjs', 'restart', '--no-open']])
})

// A fake spawn that runs the orchestrator in-process, as the detached child would.
function inProcessSpawn({ launch, spawned = [], graceMs = 150, mutate }) {
  return (command, args, options) => {
    spawned.push({ command, args, options })
    const child = Object.assign(new EventEmitter(), { unref() {} })
    setImmediate(async () => {
      mutate?.(options.env)
      try { child.result = await orchestrateRestart(options.env, launch, { graceMs, waitGoMs: 2_000 }) } catch (error) { child.error = error }
      child.emit('exit', child.result ?? 1, null)
    })
    return child
  }
}

test('schedule returns before the Host stops; orchestrator runs the restart with a clean env', async t => {
  const home = tmpHome(t)
  const order = []
  let seenEnv
  const launch = async ({ env, onPhase, orchestrated }) => {
    assert.equal(orchestrated, true)
    seenEnv = env
    order.push('launch')
    onPhase('stopping'); onPhase('stopped'); onPhase('starting', { port: 3080 })
    return 0
  }
  const spawned = []
  const logs = []
  const rc = await scheduleRestart({ argv: ['restart', '--no-open'], repo: '/repo', home, caller: { DSH_HOME: home, DSH_SHELL: '1', DSH_SESSION_ID: 's' }, evidence: { kind: 'marker', detail: 'DSH_SHELL=1' }, platform: 'darwin', log: line => logs.push(line), warn: () => {}, spawn: inProcessSpawn({ launch, spawned }) })
  order.push('returned')
  assert.equal(rc, 0)
  assert.match(logs.join('\n'), /本次会话将断开/)
  assert.match(logs.join('\n'), /返回 0 只表示已排程/)
  assert.deepEqual(spawned[0].args, ['/repo/bin/dsh.mjs', 'restart', '--no-open'])
  assert.equal(spawned[0].options.detached, true)
  assert.equal(spawned[0].options.stdio, 'ignore')
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.deepEqual(order, ['returned', 'launch'])
  assert.equal(seenEnv.DSH_SHELL, undefined)
  assert.equal(seenEnv.DSH_RESTART_NONCE, undefined)
  assert.equal(seenEnv.DSH_HOME, home)
  assert.deepEqual(receipts(home).map(event => event.phase), ['scheduling', 'orchestrator-ready', 'stopping', 'stopped', 'starting', 'ready'])
  assert.deepEqual(fs.readdirSync(path.join(home, 'state', 'dsh-restart')), [])
  assert.match(restartHistory(home).join('\n'), /ready/)
})

test('no ack: the Host is not touched and the failure is recorded', async t => {
  const home = tmpHome(t)
  const warnings = []
  const spawn = () => Object.assign(new EventEmitter(), { unref() {} })
  const rc = await scheduleRestart({ argv: ['restart'], repo: '/repo', home, caller: {}, evidence: { kind: 'marker', detail: 'x' }, platform: 'linux', log: () => {}, warn: line => warnings.push(line), spawn, readyTimeoutMs: 200 })
  assert.equal(rc, 1)
  assert.match(warnings.join('\n'), /当前 Host 未停止/)
  const last = receipts(home).at(-1)
  assert.equal(last.phase, 'failed')
  assert.equal(last.reason, 'no-ack')
})

test('an orchestrator that dies early fails fast without waiting for the ack timeout', async t => {
  const home = tmpHome(t)
  const spawn = () => { const child = Object.assign(new EventEmitter(), { unref() {} }); setImmediate(() => child.emit('exit', 1, null)); return child }
  const started = Date.now()
  const rc = await scheduleRestart({ argv: ['restart'], repo: '/repo', home, caller: {}, evidence: { kind: 'cgroup', detail: 'x' }, platform: 'linux', ...quiet, spawn, readyTimeoutMs: 5_000 })
  assert.equal(rc, 1)
  assert.ok(Date.now() - started < 2_000)
  assert.match(receipts(home).at(-1).reason, /orchestrator exited 1/)
  assert.deepEqual(fs.readdirSync(path.join(home, 'state', 'dsh-restart')), [])
})

test('a forged or partial handoff never runs the restart', async t => {
  const home = tmpHome(t)
  let called = false
  const launch = async () => { called = true; return 0 }
  await assert.rejects(orchestrateRestart({ DSH_RESTART_ORCHESTRATED: '1' }, launch), /invalid internal restart handoff/)
  const dir = path.join(home, 'state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, restartId: 'r', nonce: 'right', home }))
  await assert.rejects(orchestrateRestart({ DSH_RESTART_DIR: dir, DSH_RESTART_NONCE: 'wrong' }, launch), /invalid internal restart handoff/)
  assert.equal(called, false)
})

test('abort wins over go and the Host stays up', async t => {
  const home = tmpHome(t)
  const dir = path.join(home, 'state', 'r')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ version: 1, restartId: 'r', nonce: 'n', home }))
  for (const phase of ['go', 'abort']) fs.writeFileSync(path.join(dir, phase), JSON.stringify({ nonce: 'n', phase }))
  let called = false
  assert.equal(await orchestrateRestart({ DSH_RESTART_DIR: dir, DSH_RESTART_NONCE: 'n' }, async () => { called = true; return 0 }, { graceMs: 0 }), 1)
  assert.equal(called, false)
  assert.deepEqual(receipts(home).at(-1), { ...receipts(home).at(-1), phase: 'failed', reason: 'aborted', hostStopped: false })
})

test('a failure after stop is reported as such', async t => {
  const home = tmpHome(t)
  const launch = async ({ onPhase }) => { onPhase('stopping'); onPhase('stopped'); onPhase('starting'); throw new Error('boom') }
  assert.equal(await scheduleRestart({ argv: ['restart'], repo: '/repo', home, caller: {}, evidence: { kind: 'marker', detail: 'x' }, platform: 'darwin', ...quiet, spawn: inProcessSpawn({ launch, graceMs: 0 }) }), 0)
  await new Promise(resolve => setTimeout(resolve, 300))
  const last = receipts(home).at(-1)
  assert.deepEqual([last.phase, last.failedPhase, last.hostStopped, last.reason], ['failed', 'starting', true, 'boom'])
})

test('runLauncher: session restart schedules before any probe, update or stop', async t => {
  const home = tmpHome(t)
  // A bare repo: the checkout's .env.local could redirect DSH_HOME or DSH_PORT.
  const repo = tmpHome(t)
  const calls = []
  const record = name => async () => { calls.push(name); return { status: 0, stdout: '', stderr: '', state: 'empty', processes: [], ok: true } }
  const options = { repo, env: { DSH_HOME: home, DSH_SKIP_UPDATE: '1', DSH_PORT: '1' }, ...quiet, probe: record('probe'), stop: record('stop'), run: record('run'), platform: 'linux', isolatedHome: () => false, sessionContext: { kind: 'marker', detail: 'DSH_SHELL=1' } }
  await assert.rejects(runLauncher(['restart', '--foreground'], options), /--foreground/)
  const spawned = []
  const restartSpawn = (command, args) => { spawned.push([command, args]); const child = Object.assign(new EventEmitter(), { unref() {} }); setImmediate(() => child.emit('exit', 1, null)); return child }
  assert.equal(await runLauncher(['restart', '--no-open'], { ...options, restartSpawn }), 1)
  assert.deepEqual(spawned, [[process.execPath, [path.join(repo, 'bin', 'dsh.mjs'), 'restart', '--no-open']]])
  assert.deepEqual(calls, [])
  await assert.rejects(runLauncher(['restart'], { ...options, platform: 'win32' }), /Windows 不支持/)
})

test('runLauncher: an orchestrated env only accepts restart', async t => {
  // Stubbed probe/stop on an unused port: this must never reach a live Host, even
  // when run against a launcher without the guard.
  const home = tmpHome(t)
  const stopped = []
  const options = { repo: tmpHome(t), env: { DSH_RESTART_ORCHESTRATED: '1', DSH_HOME: home, DSH_PORT: '1' }, ...quiet, isolatedHome: () => false, probe: async () => ({ state: 'empty', processes: [] }), stop: async port => { stopped.push(port); return { ok: true, state: 'empty' } } }
  await assert.rejects(runLauncher(['stop'], options), /invalid internal restart handoff/)
  assert.deepEqual(stopped, [])
})
