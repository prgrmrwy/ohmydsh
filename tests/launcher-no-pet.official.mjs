import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { preparePetStop, verifyStopProtocol } from '../scripts/launcher/pet-stop.mjs'
import { noPetStopPatch } from '../scripts/launcher/no-pet-stop-profile.mjs'
import { runLauncher } from '../scripts/launcher/main.mjs'
import { stopServer } from '../scripts/launcher/process.mjs'

const root = path.resolve(import.meta.dirname, '..')
// This acceptance consumes a complete built official rc.2 graph. Never skip a
// negative control when the prerequisite is absent: report the missing graph.
const runtime = process.env.DSH_TEST_OFFICIAL_RUNTIME
assert(runtime && path.isAbsolute(runtime), 'DSH_TEST_OFFICIAL_RUNTIME must name a complete built rc.2 runtime directory')
const requireRuntime = createRequire(path.join(runtime, 'package.json'))
const cli = path.dirname(requireRuntime.resolve('@deepseek-ai/dsh/package.json'))
assert.equal(JSON.parse(fs.readFileSync(path.join(cli, 'package.json'))).version, '0.2.0-rc.2')
const { runProfile } = await import(pathToFileURL(path.join(cli, 'lib/profile-boot.js')))
const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-launch-environment')))
const { loadProfileDirectory } = await import(pathToFileURL(requireRuntime.resolve('@deepseek-ai/dsh-app-boot')))

async function boot(t, extra = [], full = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-no-pet-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const dir = path.join(home, 'profiles/web')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'included.json'), JSON.stringify([{ id: 'included-timer', name: '@deepseek-ai/cordis-plugin-timer' }]))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-pet-fixture', type: 'module', dsh: { profile: { bundles: full ? ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] : [] } } }))
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n')
  const overlay = path.join(home, 'launcher.patch.json')
  fs.writeFileSync(overlay, JSON.stringify(full ? [
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { openBrowser: false, printUrl: false, surfaceContext: false, trustedHosts: [] } },
    { id: 'session-telemetry-otel', disabled: true },
    { insert: extra },
  ] : [{ insert: [
    { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local' },
    { id: 'connection', name: '@deepseek-ai/dsh-client-connection' },
    ...extra,
  ] }]))
  let ctx
  const events = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection']
  const listeners = new Map(events.map(event => [event, process.rawListeners(event)]))
  t.after(async () => {
    await ctx?.fiber.dispose()
    for (const event of events) for (const listener of process.rawListeners(event)) if (!listeners.get(event).includes(listener)) process.removeListener(event, listener)
    process.env.DSH_HOME = oldHome
    if (oldHome === undefined) delete process.env.DSH_HOME
    assert(home.startsWith(path.join(os.tmpdir(), 'launcher-no-pet-')))
    fs.rmSync(home, { recursive: true, force: true })
  })
  const result = await runProfile({
    environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { DSH_HOME: home } }]),
    profile: 'web', args: [], patchFiles: [overlay, noPetStopPatch(home, root, '0.2.0-rc.2')],
    resolvedProfile: { profile: full ? loadProfileDirectory('test', dir, path.join(cli, 'package.json')) : { name: 'web', dir, patchPath: path.join(dir, 'cordis.patch.yml'), patches: [], layers: ['base', 'web-app'].map(name => ({ packageName: `@deepseek-ai/dsh-${name}`, packageDir: path.dirname(requireRuntime.resolve(`@deepseek-ai/dsh-${name}/package.json`)), patchPaths: [], patches: [] })), skippedBundles: [] }, installAnchor: path.join(cli, 'package.json') },
  })
  ctx = result.ctx
  await new Promise(setImmediate)
  const port = ctx.webServer.port
  // Supply the real Connection's index exchange without frontend build/assets.
  if (!full) ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
    if (ctx.connection.authorizeIndex(req, res)) { res.writeHead(200); res.end('fixture') }
  } }))
  const file = path.join(home, `run/dsh-pet-stop/${port}.json`)
  const identity = { pid: process.pid, created: 'fixture-owned-process', executable: process.execPath, argv: [process.execPath, 'official-profile-fixture'] }
  const initial = { state: 'owned', processes: [identity] }
  return { ctx, home, port, file, initial, prepare: () => preparePetStop({ home, port, initial, probe: async () => initial }) }
}

test('real official runProfile/Loader/appReady and Connection prepare an ordinary noPet composition', async t => {
  const f = await boot(t)
  assert.equal(fs.existsSync(f.file), true, 'appReady publishes the private descriptor')
  assert.equal(fs.statSync(path.dirname(f.file)).mode & 0o777, 0o700)
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600)
  const ticket = await f.prepare()
  await ticket.beforeSignal()
  assert.equal(await ticket.resume(), 'resumed')
  await assert.rejects(ticket.beforeSignal(), /prepared|unverified/)
})

test('real Loader retains a Pet import-failure entry and refuses noPet after topology changes', async t => {
  const f = await boot(t)
  const ticket = await f.prepare()
  await f.ctx.loader.create({ id: 'failed-pet', name: 'file:///nonexistent/dsh-pet/index.mjs' })
  const entry = [...f.ctx.loader.entries()].find(entry => entry.options.id === 'failed-pet')
  assert(entry)
  assert.equal(entry.fiber, undefined)
  await assert.rejects(ticket.beforeSignal(), /unverified|failed|request|JSON/)
  await assert.rejects(f.prepare(), /descriptor|unverified|failed/)
})

test('unknown modules, disabled Pet declarations and unexpanded includes cannot publish noPet', async t => {
  for (const row of [
    { id: 'unknown', name: 'file:///nonexistent/unknown-carrier.mjs', disabled: true },
    { id: 'pet', name: 'dsh-pet', disabled: true },
    { id: 'failed-pet', name: 'file:///nonexistent/dsh-pet/index.mjs' },
    { id: 'unknown-carrier', name: '@deepseek-ai/cordis-plugin-group', group: true, config: [] },
    { id: 'include', name: 'cordis:include', disabled: true, config: { path: './missing.yml' } },
  ]) await t.test(row.id, async t => {
    const f = await boot(t, [row])
    assert.equal(fs.existsSync(f.file), false)
    await assert.rejects(f.prepare(), /descriptor/)
  })
})

test('real Connection and noPet reject wrong Host, nonce, PID and boot identity', async t => {
  const f = await boot(t)
  const descriptor = JSON.parse(fs.readFileSync(f.file, 'utf8'))
  const auth = await fetch(descriptor.authenticatedUrl, { redirect: 'manual' })
  assert.equal(auth.status, 303)
  const cookie = auth.headers.get('set-cookie').split(';', 1)[0]
  const body = { v: 1, action: 'prepare', nonce: 'a'.repeat(32), expectedHostPid: process.pid, expectedBootId: descriptor.bootId, deadlineAt: Date.now() + 10000 }
  const send = (delta = {}, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request(`${descriptor.origin}/dsh-pet/api/prepare-stop`, { method: 'POST', headers: { Cookie: cookie, Origin: descriptor.origin, 'Content-Type': 'application/json', ...headers } }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, json: async () => JSON.parse(Buffer.concat(chunks)) }))
    })
    req.on('error', reject)
    req.end(JSON.stringify({ ...body, ...delta }))
  })
  assert.equal((await send({}, { Host: `localhost:${f.port}` })).status, 403)
  assert.equal((await send({}, { Origin: `http://localhost:${f.port}` })).status, 403)
  assert.equal((await send({}, { Cookie: '' })).status, 401)
  for (const delta of [{ nonce: '' }, { expectedHostPid: 1 }, { expectedBootId: 'wrong' }]) assert((await send(delta)).status >= 400)
  assert.equal((await send()).status, 200)
  assert.equal((await send({ action: 'status', nonce: 'b'.repeat(32) })).status, 409)
  const status = await (await send({ action: 'status' })).json()
  assert.equal(status.data.operationNonce, body.nonce)
  assert.equal(status.data.phase, 'prepared')
})

test('complete shipped official Web profile with its presets can stop without a legacy flag', async t => {
  const f = await boot(t, [], true)
  const known = JSON.parse(fs.readFileSync(path.join(root, 'scripts/launcher/no-pet-known-modules.json'))).modules
  const odd = [...f.ctx.loader.entries()].filter(e => !known.includes(e.options.name) && !e.options.name.startsWith('cordis:') && !e.options.name.includes('no-pet-stop-plugin')).map(e => [e.id, e.options.name, e.fiber?.state])
  assert.equal(fs.existsSync(f.file), true, JSON.stringify(odd))
  await verifyStopProtocol({ home: f.home, port: f.port, initial: f.initial, probe: async () => f.initial })
  let current = f.initial
  const signals = []
  const result = await runLauncher(['stop'], {
    repo: f.home, env: { DSH_HOME: f.home, DSH_PORT: String(f.port) }, isolatedHome: () => false,
    log: () => {}, warn: () => {}, probe: async () => current,
    stop: (port, options) => stopServer(port, { ...options, connect: async () => false, signal: async (pid, kind) => { signals.push([pid, kind]); current = { state: 'empty', processes: [] } } }),
  })
  assert.equal(result, 0)
  assert.deepEqual(signals, [[process.pid, 'SIGTERM']], 'signal port is stubbed; no real process is stopped')
})

test('real expanded group/include trees succeed, while preset-hidden Pet and unknown carriers refuse', async t => {
  const f = await boot(t, [{ id: 'group', name: 'cordis:group', group: true, config: [{ id: 'include', name: 'cordis:include', config: { path: './included.json' } }] }])
  await (await f.prepare()).beforeSignal()
  const g = [...f.ctx.loader.entries()].find(e => e.options.id === 'group')
  assert(g.subgroup)
  for (const row of [
    { id: 'preset', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'hidden', plugins: [{ id: 'pet', name: 'dsh-pet', disabled: true }] } },
    { id: 'unknown', name: '@deepseek-ai/cordis-plugin-group', group: true, config: [] },
  ]) await t.test(row.id, async t => {
    const f = await boot(t, [row], true)
    const entry = [...f.ctx.loader.entries()].find(e => e.options.id === row.id)
    assert.equal(entry.fiber.state, 2, 'negative control reaches an active official declaration')
    assert.equal(fs.existsSync(f.file), false)
  })
})

test('retained official preset revisions remain visible when current declarations remove Pet', async t => {
  const f = await boot(t, [{ id: 'retained', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'retained', plugins: [{ id: 'pet', name: 'dsh-pet', disabled: true }] } }], true)
  assert.equal(fs.existsSync(f.file), false)
  const lease = await f.ctx.agentPresets.acquireScope('retained')
  t.after(() => lease[Symbol.asyncDispose]())
  const preset = [...f.ctx.loader.entries()].find(e => e.options.id === 'retained')
  await f.ctx.loader.update(preset.id, { config: { id: 'retained', plugins: [] } })
  await f.ctx.loader.await()
  const stop = [...f.ctx.loader.entries()].find(e => e.options.id === 'launcher-no-pet-stop')
  await f.ctx.loader.update(stop.id, { disabled: true })
  await f.ctx.loader.await()
  await f.ctx.loader.update(stop.id, { disabled: false })
  await f.ctx.loader.await()
  assert.equal(fs.existsSync(f.file), false, 'retained Pet revision prevents a fresh noPet descriptor')
  await lease[Symbol.asyncDispose]()
  const { livePresetMounts } = await preset.parent.tree.import('@deepseek-ai/dsh-agent-preset-registry')
  assert.deepEqual(livePresetMounts(f.ctx.root.fiber).flatMap(m => [...m.tree.entries()].filter(e => e.options.name === 'dsh-pet').map(e => e.id)), [], 'no retained Pet tree remains after releasing the lease')
  assert.deepEqual(preset.options.config.plugins, [])
  assert.equal(stop.disabled, false)
  assert.equal(stop.fiber.state, 2)
  await f.ctx.loader.update(stop.id, { disabled: true })
  await f.ctx.loader.await()
  await f.ctx.loader.update(stop.id, { disabled: false })
  await f.ctx.loader.await()
  await assert.rejects(verifyStopProtocol({ home: f.home, port: f.port, initial: f.initial, probe: async () => f.initial, deadlineAt: Date.now() + 100 }), /descriptor/)
  assert.equal(fs.existsSync(f.file), false, 'a Host that exposed Pet never downgrades to a noPet proof after removing its entries')
  await t.test('a fresh noPet Host remains certifiable', async t => {
    const fresh = await boot(t, [], true)
    await (await fresh.prepare()).beforeSignal()
  })
})

test('real official dynamic runner inventory is an unknown carrier even outside Loader.entries', async t => {
  const f = await boot(t, [], true)
  const ticket = await f.prepare()
  const before = [...f.ctx.loader.entries()]
  f.ctx.dynamicCordisRunner.define({ sessionId: 'fixture-session', plugin: { kind: 'new', idPrefix: 'opaque' }, name: 'unknown carrier', purpose: 'noPet negative control', code: { host: 'return { apply() {} }' } })
  assert.deepEqual([...f.ctx.loader.entries()], before, 'the dynamic registry does not create a Loader entry')
  assert.equal(f.ctx.dynamicCordisRunner.inventory().length, 1)
  await assert.rejects(ticket.beforeSignal(), /unverified/)
  await assert.rejects(f.prepare(), /Host 未停止/)
})
