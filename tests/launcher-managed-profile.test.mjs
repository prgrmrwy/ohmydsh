// Managed non-web profile Host: `DSH_PROFILE=<profile> dsh -p <port>`.
// Hermetic: stub DSH runtime on a free loopback port, isolated DSH_HOME.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, cp, symlink, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { probePort, stopServer, isDshHostProcess, isDshWebProcess, classifyPort } from '../scripts/launcher/process.mjs'
import { runLauncher } from '../scripts/launcher/main.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const record = (profile, port = 40001, overrides = {}) => ({
  pid: 1234, parentPid: 1000, created: 'creation-1', executable: process.execPath,
  argv: ['/usr/bin/node', '/cache/node_modules/@deepseek-ai/dsh/lib/bin.js', profile, '--port', String(port)],
  ...overrides,
})

test('ownership is decided by the exact profile argv', () => {
  assert.equal(isDshHostProcess(record('superagent'), 40001, { profile: 'superagent' }), true)
  assert.equal(isDshHostProcess(record('superagent'), 40001), false, 'default profile is web')
  assert.equal(isDshHostProcess(record('web'), 40001, { profile: 'superagent' }), false)
  assert.equal(isDshHostProcess(record('superagent'), 40002, { profile: 'superagent' }), false, 'port must still match')
  assert.equal(isDshHostProcess(record('superagent-x'), 40001, { profile: 'superagent' }), false)
  for (const profile of ['', '../web', '-web', 'a b', undefined, 7]) assert.equal(isDshHostProcess(record(String(profile)), 40001, { profile }), false, JSON.stringify(profile))
  // historical predicate stays the web case
  assert.equal(isDshWebProcess(record('web'), 40001), true)
  assert.equal(isDshWebProcess(record('superagent'), 40001), false)
  assert.equal(classifyPort([record('superagent')], true, 40001, { profile: 'superagent' }).state, 'owned')
  assert.equal(classifyPort([record('superagent')], true, 40001).state, 'unknown')
  assert.equal(classifyPort([record('web')], true, 40001, { profile: 'superagent' }).state, 'unknown')
})

test('probePort rejects an invalid profile without probing', async () => {
  let ran = false
  const result = await probePort(40001, { profile: '../x', run: async () => { ran = true; return { status: 1, stdout: '', stderr: '' } } })
  assert.equal(result.state, 'probe-error')
  assert.equal(ran, false)
})

async function guardHome(t, { profileDir = true } = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh managed-profile guard '))
  t.after(() => rm(home, { recursive: true, force: true }))
  if (profileDir) { await mkdir(path.join(home, 'profiles/superagent'), { recursive: true }); await writeFile(path.join(home, 'profiles/superagent/cordis.yml'), 'plugins: []\n') }
  return home
}
// Every refusal must happen before any script, probe or stop.
async function refused(t, argv, pattern, { env = {}, isolated = false, profileDir = true } = {}) {
  const home = await guardHome(t, { profileDir })
  const effects = []
  await assert.rejects(() => runLauncher(argv, {
    repo: ROOT, env: { DSH_HOME: home, DSH_PROFILE: 'superagent', DSH_LOCAL_MANIFEST: path.join(home, 'absent'), ...env },
    isolatedHome: () => isolated, sessionContext: 'external', log: () => {}, warn: () => {},
    run: async (...args) => { effects.push(['run', args]); return { status: 0, stdout: '', stderr: '' } },
    probe: async () => { effects.push(['probe']); return { state: 'empty', processes: [] } },
    stop: async () => { effects.push(['stop']); return { ok: true, state: 'empty' } },
    spawn: () => { effects.push(['spawn']); throw new Error('must not spawn') },
  }), pattern, argv.join(' '))
  assert.deepEqual(effects, [], argv.join(' '))
}

test('non-web profile requires an explicit port', async t => {
  await refused(t, [], /requires an explicit -p\/--port/)
  await refused(t, ['--no-open'], /requires an explicit -p\/--port/, { env: { DSH_PORT: '3082' } })
})

test('non-web profile refuses build and maintenance commands that deploy into the profile', async t => {
  for (const argv of [['build'], ['-b', '-p', '3082'], ['--build', '-p', '3082'], ['reset'], ['doctor'], ['doctor', '--check'], ['plugin-update', '--dry-run']]) {
    await refused(t, argv, /只选择受管 Host 的 profile/)
  }
})

test('non-web profile refuses preview, invalid names, missing profile and unauthenticated stop/restart', async t => {
  await refused(t, ['-p', '3182'], /隔离预览环境只支持 web/, { isolated: true })
  await refused(t, ['-p', '3082'], /not a valid profile name/, { env: { DSH_PROFILE: '../web' } })
  await refused(t, ['-p', '3082'], /cordis\.yml 不存在/, { profileDir: false })
  await refused(t, ['stop', '-p', '3082'], /stop\/restart 不支持.*--allow-legacy-restart/)
  await refused(t, ['restart', '-p', '3082'], /stop\/restart 不支持.*--allow-legacy-restart/)
})

test('non-web history stays read-only and needs no port', async t => {
  const home = await guardHome(t)
  const lines = []
  // A repo without .env.local: a worktree's managed DSH_HOME block would otherwise override the caller's home.
  const repo = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh managed-profile repo '))
  t.after(() => rm(repo, { recursive: true, force: true }))
  await cp(path.join(ROOT, 'dsh.yaml'), path.join(repo, 'dsh.yaml'))
  const status = await runLauncher(['history'], { repo, env: { DSH_HOME: home, DSH_PROFILE: 'superagent' }, isolatedHome: () => false, log: line => lines.push(line), probe: async () => { throw new Error('no probe') }, run: async () => { throw new Error('no run') } })
  assert.equal(status, 0)
  assert.match(lines.join('\n'), /no startup history yet/)
})

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh managed-profile 中文 ')); const home = path.join(root, 'home')
  const port = await freePort()
  await mkdir(path.join(root, 'bin'), { recursive: true })
  await cp(path.join(ROOT, 'bin/dsh.mjs'), path.join(root, 'bin/dsh.mjs'))
  await cp(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true })
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
  await cp(path.join(ROOT, 'package-lock.json'), path.join(root, 'package-lock.json'))
  await symlink(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(path.join(root, 'dsh.yaml'), 'dshVersion: 0.2.0-rc.2\nautoUpdate:\n  enabled: false\nweb:\n  open: false\ncustomizations: []\n')
  await mkdir(path.join(home, 'profiles/superagent'), { recursive: true })
  await writeFile(path.join(home, 'profiles/superagent/cordis.yml'), 'plugins: []\n')
  const pkg = path.join(root, 'runtime/node_modules/@deepseek-ai/dsh'); const bin = path.join(pkg, 'lib/bin.js')
  const argvLog = path.join(root, 'host-argv.jsonl'); const effects = path.join(root, 'effects.log')
  await mkdir(path.dirname(bin), { recursive: true })
  await writeFile(path.join(pkg, 'package.json'), '{"name":"@deepseek-ai/dsh","version":"0.2.0-rc.2","type":"module"}')
  await writeFile(bin, `import net from 'node:net';import fs from 'node:fs';const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(argvLog)},JSON.stringify({args,profile:process.env.DSH_PROFILE})+'\\n');const port=Number(args[args.indexOf('--port')+1]);net.createServer(s=>s.end()).listen(port,'127.0.0.1')`)
  await writeFile(path.join(root, 'scripts/dsh-server-bin.mjs'), `console.log('DSH_SERVER_BIN='+${JSON.stringify(bin)});console.log('DSH_RUNTIME_KIND=npx-cache');`)
  const record = name => `import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(effects)},${JSON.stringify(name)}+' '+(process.env.DSH_PROFILE??'')+'\\n');`
  await writeFile(path.join(root, 'scripts/check-update.mjs'), `${record('check-update')}console.log(JSON.stringify({enabled:false,status:'no-update'}))`)
  await writeFile(path.join(root, 'scripts/sync.mjs'), record('sync'))
  await writeFile(path.join(root, 'scripts/host-prerequisites.mjs'), 'process.exit(0)')
  await writeFile(path.join(root, 'scripts/plugin-list.mjs'), "console.log('fixture-plugin')")
  const run = (args, extra = {}) => new Promise(resolve => {
    const c = spawn(process.execPath, [path.join(root, 'bin/dsh.mjs'), ...args], { cwd: root, env: { ...process.env, DSH_HOME: home, DSH_SKIP_HOST_PREREQUISITES: '1', DSH_BIN: undefined, DSH_PROFILE: undefined, DSH_LOCAL_MANIFEST: path.join(root, 'absent'), DSH_RESTART_CONTEXT: 'external', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; c.stdout.on('data', x => stdout += x); c.stderr.on('data', x => stderr += x)
    const timer = setTimeout(() => c.kill('SIGKILL'), 12000)
    c.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }) })
  })
  const read = async file => existsSync(file) ? (await readFile(file, 'utf8')).split('\n').filter(Boolean) : []
  t.after(async () => {
    for (const profile of ['superagent', 'web']) { const status = await probePort(port, { profile }); if (status.state === 'owned') await stopServer(port, { expectedIdentity: status, profile }) }
    await rm(root, { recursive: true, force: true })
  })
  return { root, home, port, run, hostArgv: async () => (await read(argvLog)).map(line => JSON.parse(line)), effects: () => read(effects) }
}

test('managed superagent start: profile argv, no stop patch, no deploy, profile in history, stop refused', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const env = { DSH_PROFILE: 'superagent' }
  const started = await f.run(['-p', String(f.port), '--no-open'], env)
  assert.equal(started.status, 0, started.stderr)
  const [host] = await f.hostArgv()
  assert.equal(host.args[0], 'superagent')
  assert.deepEqual(host.args.slice(1, 4), ['--port', String(f.port), '--no-open'])
  assert.equal(host.args.includes('--patch'), false, 'non-web must not load the no-pet-stop patch')
  assert.equal(host.profile, 'superagent')
  assert.deepEqual(await f.effects(), [], 'non-web start must not run autoUpdate/sync')
  assert.equal(existsSync(path.join(f.home, 'no-pet-stop.patch.json')), false)
  assert.equal((await probePort(f.port, { profile: 'superagent' })).state, 'owned')
  assert.equal((await probePort(f.port)).state, 'unknown', 'a web probe never owns a superagent Host')
  assert.match(await readFile(path.join(f.home, 'dsh-startup.log'), 'utf8'), /runtime=npx-cache profile=superagent port=\d+ plugins=\[fixture-plugin\]/)

  const reused = await f.run(['-p', String(f.port), '--no-open'], env)
  assert.equal(reused.status, 0, reused.stderr)
  assert.match(reused.stdout, /已在运行/)
  assert.equal((await f.hostArgv()).length, 1, 'already-running Host is reused, not respawned')

  const before = await probePort(f.port, { profile: 'superagent' })
  for (const command of ['stop', 'restart']) {
    const result = await f.run([command, '-p', String(f.port)], env)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /stop\/restart 不支持/)
  }
  const web = await f.run(['stop', '-p', String(f.port)])
  assert.notEqual(web.status, 0, 'web stop must not adopt a superagent listener')
  const after = await probePort(f.port, { profile: 'superagent' })
  assert.equal(after.state, 'owned')
  assert.equal(after.processes[0].pid, before.processes[0].pid, 'no refused command may signal the Host')

  const maintenance = await f.run(['stop', '--allow-legacy-restart', '-p', String(f.port)], env)
  assert.equal(maintenance.status, 0, maintenance.stderr)
  assert.equal((await probePort(f.port, { profile: 'superagent' })).state, 'empty')
})

test('web start regression: web argv, stop patch, autoUpdate checked', { timeout: 30000 }, async t => {
  const f = await fixture(t)
  const started = await f.run(['-p', String(f.port), '--no-open'], { DSH_PROFILE: 'web' })
  assert.equal(started.status, 0, started.stderr)
  const [host] = await f.hostArgv()
  assert.equal(host.args[0], 'web')
  assert.equal(host.args[1], '--patch')
  assert.match(host.args[2], /no-pet-stop/)
  assert.deepEqual(await f.effects(), ['check-update web'])
  assert.match(await readFile(path.join(f.home, 'dsh-startup.log'), 'utf8'), /profile=web port=/)
  assert.equal((await probePort(f.port)).state, 'owned')
})
