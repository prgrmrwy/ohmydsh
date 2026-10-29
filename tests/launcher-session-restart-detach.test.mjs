import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MANAGED_RANGE } from '../scripts/launcher/session-restart.mjs'

// Real processes, no Host: a fake "managed range" runs the session-side
// scheduler, then the range is killed the way Host disposal kills it. The
// detached orchestrator must survive and complete its (stub) restart.
const MODULE = fileURLToPath(new URL('../scripts/launcher/session-restart.mjs', import.meta.url))
const wait = async (predicate, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (predicate()) return true; await new Promise(r => setTimeout(r, 50)) } return predicate() }

function fixture(t, kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restart-detach-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home'); const out = path.join(root, 'out.json'); const scheduled = path.join(root, 'scheduled')
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
  // The re-exec target: the orchestrator with a stub launch that records where it ran.
  fs.writeFileSync(path.join(root, 'bin', 'dsh.mjs'), `import fs from 'node:fs';import {orchestrateRestart} from ${JSON.stringify(MODULE)};
process.exitCode=await orchestrateRestart(process.env,async({env})=>{await new Promise(r=>setTimeout(r,500));let cgroup='';try{cgroup=fs.readFileSync('/proc/self/cgroup','utf8')}catch{};fs.writeFileSync(process.env.FIXTURE_OUT,JSON.stringify({pid:process.pid,cgroup,marker:env.DSH_SHELL??null}));return 0},{graceMs:300})`)
  // The session side: schedule, report, then block like a tool call would.
  fs.writeFileSync(path.join(root, 'range.mjs'), `import fs from 'node:fs';import {scheduleRestart} from ${JSON.stringify(MODULE)};
const rc=await scheduleRestart({argv:['restart'],repo:${JSON.stringify(root)},home:${JSON.stringify(home)},caller:process.env,evidence:{kind:${JSON.stringify(kind)},detail:'fixture'},platform:process.platform,log:()=>{},warn:m=>console.error(m)});
fs.writeFileSync(${JSON.stringify(scheduled)},String(rc));setInterval(()=>{},1000)`)
  const env = { ...process.env, DSH_HOME: home, DSH_SHELL: '1', FIXTURE_OUT: out }
  return { root, home, out, scheduled, env }
}

function systemdUnavailable() {
  if (process.platform !== 'linux') return 'not Linux'
  if (spawnSync('systemctl', ['--user', 'show', '--property=Version'], { encoding: 'utf8' }).status !== 0) return 'user systemd unavailable'
  if (spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '--', 'true']).status !== 0) return 'systemd-run --user --scope unavailable'
  return false
}

test('Linux: orchestrator survives SIGKILL of the Host-managed scope it was scheduled from', { skip: systemdUnavailable() }, async t => {
  const f = fixture(t, 'cgroup')
  const unit = `dsh-subprocess-${process.pid}-${crypto.randomBytes(6).toString('hex')}.scope`
  assert.match(unit, MANAGED_RANGE)
  const range = spawn('systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', process.execPath, path.join(f.root, 'range.mjs')], { env: f.env, stdio: 'ignore' })
  t.after(() => { spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', unit]); range.kill('SIGKILL') })
  assert.ok(await wait(() => fs.existsSync(f.scheduled), 10_000), 'schedule did not complete')
  assert.equal(fs.readFileSync(f.scheduled, 'utf8'), '0')
  assert.equal(fs.existsSync(f.out), false, 'restart must not run before the grace period')
  assert.equal(spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', unit]).status, 0)
  assert.ok(await wait(() => fs.existsSync(f.out), 10_000), 'orchestrator died with the range')
  const result = JSON.parse(fs.readFileSync(f.out, 'utf8'))
  assert.match(result.cgroup, /dsh-restart-[^/]+\.scope/)
  assert.doesNotMatch(result.cgroup, MANAGED_RANGE)
  assert.equal(result.marker, null)
  const phases = fs.readFileSync(path.join(f.home, 'dsh-restart.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line).phase)
  assert.ok(await wait(() => fs.readFileSync(path.join(f.home, 'dsh-restart.log'), 'utf8').includes('"ready"'), 5_000))
  assert.deepEqual(phases.slice(0, 2), ['scheduling', 'orchestrator-ready'])
})

test('POSIX fallback (macOS, Linux without user systemd): orchestrator survives a process-group kill', { skip: process.platform === 'win32' && 'POSIX only' }, async t => {
  const f = fixture(t, 'marker')
  const range = spawn(process.execPath, [path.join(f.root, 'range.mjs')], { env: f.env, stdio: 'ignore', detached: true })
  t.after(() => { try { process.kill(-range.pid, 'SIGKILL') } catch {} })
  assert.ok(await wait(() => fs.existsSync(f.scheduled), 10_000), 'schedule did not complete')
  assert.equal(fs.readFileSync(f.scheduled, 'utf8'), '0')
  process.kill(-range.pid, 'SIGKILL')
  assert.ok(await wait(() => fs.existsSync(f.out), 10_000), 'orchestrator died with the process group')
  assert.ok(await wait(() => fs.readFileSync(path.join(f.home, 'dsh-restart.log'), 'utf8').includes('"ready"'), 5_000))
})
