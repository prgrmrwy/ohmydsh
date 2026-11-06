import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runLauncher } from '../scripts/launcher/main.mjs'
import { stopServer } from '../scripts/launcher/process.mjs'
import http from 'node:http'
import { once, EventEmitter } from 'node:events'
import { preparePetStop, verifyStopProtocol } from '../scripts/launcher/pet-stop.mjs'

const identity = (overrides = {}) => ({ pid: 42424, created: 'boot-time-1', executable: process.execPath,
  argv: [process.execPath, '/fake/node_modules/@deepseek-ai/dsh/lib/bin.js', 'web', '--port', '40001'], ...overrides })
const owned = record => ({ state: 'owned', processes: [record] })
function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-pet-stop-'))
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  fs.writeFileSync(path.join(repo, 'dsh.yaml'), 'dshVersion: 0.2.0-rc.2\nautoUpdate: {enabled: false}\nweb: {open: false}\ncustomizations: []\n')
  const calls = [], home = path.join(repo, 'home')
  return { repo, home, calls, options: { repo, env: { DSH_HOME: home, DSH_PORT: '40001', DSH_SKIP_HOST_PREREQUISITES: '1' },
    platform: 'linux', isolatedHome: () => false, sessionContext: 'external', log: () => {}, warn: () => {},
    probe: async () => owned(identity()), stop: async (_port, options) => { calls.push(['stop', options]); return { ok: true, state: 'empty' } },
    run: async (_command, args) => { calls.push(['run', args]); return { status: 0, stdout: args[0]?.endsWith('dsh-server-bin.mjs') ? 'DSH_SERVER_BIN=fixture.js\nDSH_RUNTIME_KIND=env\n' : '', stderr: '' } },
  } }
}

test('stop without a Pet descriptor proceeds without drain and never provisions', async t => {
  const f = fixture(t)
  assert.equal(await runLauncher(['stop'], f.options), 0)
  assert.equal(f.calls.some(([name]) => name === 'stop'), true)
  assert.equal(f.calls.some(([name]) => name === 'run'), false, 'stop does not provision or inspect mutable plugins')
})

test('restart without a Pet descriptor stops the old Host after runtime preparation', async t => {
  const f = fixture(t)
  await runLauncher(['restart', '--no-open'], f.options).catch(() => {})
  assert.equal(f.calls.some(([name, args]) => name === 'run' && args[0]?.endsWith('dsh-server-bin.mjs')), true)
  const prepared = f.calls.findIndex(([name, args]) => name === 'run' && args[0]?.endsWith('dsh-server-bin.mjs'))
  const stopped = f.calls.findIndex(([name]) => name === 'stop')
  assert.ok(stopped > prepared, 'the old Host is stopped only after the new runtime is prepared')
})

async function petFixture(t, change = {}) {
  const f = fixture(t)
  f.requests = []; f.logs = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined
    f.requests.push({ method: req.method, url: req.url, headers: req.headers, body })
    if (req.method === 'GET') {
      const auth = typeof change.auth === 'function' ? change.auth(f) : change.auth ?? {}
      res.writeHead(auth.status ?? 303, { Location: auth.location ?? '/', 'Set-Cookie': auth.cookie ?? 'dsh_connection=fake-signed-cookie; HttpOnly; Path=/' })
      res.end('fake-launch-secret fake-signed-cookie')
      return
    }
    const data = body.action === 'status' && f.prepared ? { ...f.prepared } : { v: 1, nonce: body.nonce, hostPid: body.expectedHostPid, bootId: body.expectedBootId,
      phase: body.action === 'prepare' ? 'prepared' : 'active', operationNonce: body.action === 'prepare' ? body.nonce : null, preparedAt: Date.now(), expiresAt: Math.min(body.deadlineAt, Date.now() + 20000) }
    const response = await change[body.action]?.({ f, body, data, req }) ?? { ok: true, data }
    if (body.action === 'prepare') f.prepared = response.data
    if (body.action === 'resume') f.prepared = undefined
    res.writeHead(response.httpStatus ?? 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(response))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  f.port = server.address().port
  f.origin = `http://127.0.0.1:${f.port}`
  f.current = identity({ argv: [...identity().argv.slice(0, -1), String(f.port)] })
  f.initial = owned(structuredClone(f.current))
  f.descriptor = { v: 1, pid: f.current.pid, bootId: 'fake-boot-id', profile: 'web', origin: f.origin, authenticatedUrl: `${f.origin}/?token=fake-launch-secret`, ...change.descriptor }
  f.dir = path.join(f.home, 'run/dsh-pet-stop'); fs.mkdirSync(f.dir, { recursive: true, mode: 0o700 })
  f.file = path.join(f.dir, `${f.port}.json`)
  fs.writeFileSync(f.file, JSON.stringify(f.descriptor), { mode: 0o600 })
  Object.assign(f.options, { env: { ...f.options.env, DSH_PORT: String(f.port) }, probe: async () => owned(f.current),
    log: line => f.logs.push(line), warn: line => f.logs.push(line) })
  f.prepare = options => preparePetStop({ home: f.home, port: f.port, initial: f.initial, probe: f.options.probe, ...options })
  return f
}

test('authenticated prepared is required before stop, with the exact pre-handshake identity', async t => {
  const f = await petFixture(t)
  const originalStop = f.options.stop
  f.options.stop = async (port, options) => {
    assert.equal(f.requests.at(-1).body.action, 'status')
    assert.deepEqual(options.expectedIdentity, f.initial)
    await options.beforeSignal()
    return originalStop(port, options)
  }
  assert.equal(await runLauncher(['stop'], f.options), 0)
  assert.deepEqual(f.requests.map(req => [req.method, req.body?.action]), [['GET', undefined], ['POST', 'prepare'], ['POST', 'status'], ['POST', 'status']])
  const sent = f.requests[1]
  assert.equal(sent.headers.origin, f.origin)
  assert.equal(sent.headers.cookie, 'dsh_connection=fake-signed-cookie')
  assert.equal(sent.body.expectedHostPid, f.current.pid)
  assert.equal(sent.body.expectedBootId, f.descriptor.bootId)
  assert.match(sent.body.nonce, /^[a-f0-9]{32}$/)
  assert.equal(JSON.stringify(f.logs).includes('fake-launch-secret'), false)
  assert.equal(JSON.stringify(f.logs).includes('fake-signed-cookie'), false)
  assert.equal(f.calls.some(([name]) => name === 'run'), false)
})

test('non-prepared phases and wrong ticket fields never authorize stop and attempt same-nonce resume', async t => {
  const changes = [
    { phase: 'active' }, { phase: 'preparing' }, { phase: 'failed' }, { nonce: 'wrong' }, { hostPid: 9 }, { bootId: 'wrong' },
    { v: 2 }, { operationNonce: 'another-operation' }, { preparedAt: Date.now() + 100000 }, { expiresAt: Date.now() - 1 }, { expiresAt: Date.now() + 1000000 },
  ]
  for (const delta of changes) await t.test(JSON.stringify(delta), async t => {
    const f = await petFixture(t, { prepare: ({ data }) => ({ ok: true, data: { ...data, ...delta } }) })
    await assert.rejects(runLauncher(['stop'], f.options), /Pet.*Host 未停止/)
    assert.equal(f.calls.some(([name]) => name === 'stop'), false)
    const posts = f.requests.filter(req => req.body)
    assert.deepEqual(posts.map(req => req.body.action), ['prepare', 'resume'])
    assert.equal(posts[0].body.nonce, posts[1].body.nonce)
  })
})

test('404 is a failed authenticated handshake even with the explicit legacy flag', async t => {
  const f = await petFixture(t, { prepare: () => ({ httpStatus: 404, ok: false, error: 'fake-launch-secret fake-signed-cookie' }) })
  await assert.rejects(runLauncher(['stop', '--allow-legacy-restart'], f.options), error => /Host 未停止/.test(error.message) && !/fake-launch-secret|fake-signed-cookie/.test(error.message))
  assert.equal(f.calls.some(([name]) => name === 'stop'), false)
})

test('authentication requires 303 with a cookie and an exact same-loopback-origin redirect', async t => {
  for (const auth of [{ status: 200 }, { location: 'http://localhost:1/' }, { location: 'http://127.0.0.1:1/' }, { location: '//evil.invalid/' }, { cookie: [] }]) await t.test(JSON.stringify(auth), async t => {
    const f = await petFixture(t, { auth })
    await assert.rejects(runLauncher(['stop'], f.options), /Pet.*Host 未停止/)
    assert.equal(f.requests.length, 1, 'never follows the redirect or sends prepare without authentication')
    assert.equal(f.calls.some(([name]) => name === 'stop'), false)
  })
})

test('descriptor PID/profile/origin mismatch and unsafe files refuse before HTTP, including legacy mode', async t => {
  await t.test('stale descriptor of another PID grants nothing', async t => {
    // A crashed boot's leftover describes no live Host: treated as missing, so
    // the stop proceeds without drain, warns, and never sends HTTP.
    const f = await petFixture(t, { descriptor: { pid: 1 } })
    assert.equal(await runLauncher(['stop'], f.options), 0)
    assert.deepEqual(f.requests, [])
    assert.equal(f.calls.some(([name]) => name === 'stop'), true)
  })
  for (const delta of [{ profile: 'other' }, { bootId: '' }, { origin: 'http://evil.invalid:40001' }, { authenticatedUrl: 'http://evil.invalid/?token=fake-launch-secret' }]) await t.test(JSON.stringify(delta), async t => {
    const f = await petFixture(t, { descriptor: delta })
    await assert.rejects(runLauncher(['stop', '--allow-legacy-restart'], f.options), /Pet/)
    assert.deepEqual(f.requests, [])
    assert.equal(f.calls.some(([name]) => name === 'stop'), false)
  })
  for (const kind of ['directory-mode', 'file-mode', 'file-symlink', 'directory-symlink', 'bad-json']) await t.test(kind, async t => {
    const f = await petFixture(t)
    if (kind === 'directory-mode') fs.chmodSync(f.dir, 0o755)
    if (kind === 'file-mode') fs.chmodSync(f.file, 0o644)
    if (kind === 'bad-json') fs.writeFileSync(f.file, '{invalid')
    if (kind === 'file-symlink') { fs.renameSync(f.file, `${f.file}.real`); fs.symlinkSync(`${f.file}.real`, f.file) }
    if (kind === 'directory-symlink') { fs.renameSync(f.dir, `${f.dir}.real`); fs.symlinkSync(`${f.dir}.real`, f.dir) }
    await assert.rejects(runLauncher(['stop', '--allow-legacy-restart'], f.options), /Pet/)
    assert.deepEqual(f.requests, [])
  })
})

test('Host changes during prepare: stopServer rejects the replacement and resume never targets it', async t => {
  const f = await petFixture(t, { prepare: ({ f, data }) => { f.current = { ...f.current, created: 'replacement' }; return { ok: true, data } } })
  const signals = []
  f.options.stop = (port, options) => stopServer(port, { ...options, signal: async (...args) => signals.push(args), connect: async () => false })
  await assert.rejects(runLauncher(['stop'], f.options), /identity changed/)
  assert.deepEqual(signals, [])
  assert.deepEqual(f.requests.filter(req => req.body).map(req => req.body.action), ['prepare'])
})

test('unfinished drain refuses resume and clearly reports that the Host remains in maintenance', async t => {
  const f = await petFixture(t, { prepare: ({ data }) => ({ ok: true, data: { ...data, phase: 'preparing' } }),
    resume: ({ data }) => ({ ok: true, data: { ...data, phase: 'preparing' } }), status: ({ data }) => ({ ok: true, data: { ...data, phase: 'preparing' } }) })
  await assert.rejects(runLauncher(['stop'], f.options), /Host 未停止.*维护.*pending/)
  const posts = f.requests.filter(req => req.body)
  assert.deepEqual(posts.map(req => req.body.action), ['prepare', 'resume', 'status'])
  assert.equal(new Set(posts.map(req => req.body.nonce)).size, 1)
  assert.equal(f.calls.some(([name]) => name === 'stop'), false)
})

test('expired ticket never signals, attempts same-Host resume after deadline', async t => {
  const f = await petFixture(t, { prepare: ({ data }) => ({ ok: true, data: { ...data, expiresAt: Date.now() + 30 } }) })
  const ticket = await f.prepare()
  await new Promise(resolve => setTimeout(resolve, 40))
  const signals = []
  const result = await stopServer(f.port, { expectedIdentity: f.initial, beforeSignal: ticket.beforeSignal, probe: async () => owned(f.current), signal: async (...args) => signals.push(args) })
  assert.equal(result.ok, false)
  assert.deepEqual(signals, [])
  assert.equal(await ticket.resume(), 'resumed')
})

test('prepare timeout is bounded and recovers with the same nonce after the original deadline', async t => {
  const f = await petFixture(t, { prepare: () => new Promise(() => {}) })
  await assert.rejects(f.prepare({ deadlineAt: Date.now() + 100 }), /Host 未停止.*已恢复/)
  const posts = f.requests.filter(req => req.body)
  assert.deepEqual(posts.map(req => req.body.action), ['prepare', 'resume'])
  assert.equal(posts[0].body.nonce, posts[1].body.nonce)
  assert(posts[1].body.deadlineAt > posts[0].body.deadlineAt)
})

test('localhost authentication stays on exact localhost Origin with direct loopback transport', async t => {
  const f = await petFixture(t)
  f.descriptor.origin = `http://localhost:${f.port}`
  f.descriptor.authenticatedUrl = `${f.descriptor.origin}/?token=fake-launch-secret`
  fs.writeFileSync(f.file, JSON.stringify(f.descriptor))
  const ticket = await f.prepare()
  await ticket.beforeSignal()
  assert.equal(f.requests[1].headers.origin, f.descriptor.origin)
  assert.equal(f.requests[1].headers.host, `localhost:${f.port}`)
})

test('preview uses the same authenticated prepare and retains its record when preparation fails', async t => {
  const f = await petFixture(t, { prepare: ({ data }) => ({ ok: true, data: { ...data, phase: 'failed' } }) })
  const record = { port: f.port, pid: f.current.pid, created: f.current.created }
  fs.writeFileSync(path.join(f.home, 'preview.json'), JSON.stringify(record))
  f.options.isolatedHome = () => true
  await assert.rejects(runLauncher(['stop'], f.options), /Host 未停止/)
  assert.equal(f.calls.some(([name]) => name === 'stop'), false)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.home, 'preview.json'))), record)
  assert.deepEqual(f.requests.filter(req => req.body).map(req => req.body.action), ['prepare', 'resume'])
})

test('missing/incomplete pre-handshake identity and an initially empty port never adopt a new Host', async () => {
  for (const expectedIdentity of [undefined, owned(identity({ executable: '' })), owned(identity({ argv: [] })), owned(identity({ created: '' })), { state: 'empty', processes: [] }]) {
    const signals = []
    const result = await stopServer(40001, { expectedIdentity, probe: async () => owned(identity()), connect: async () => false, signal: async (...args) => signals.push(args) })
    assert.equal(result.ok, false)
    assert.deepEqual(signals, [])
  }
})

test('a Host without a stop descriptor is stopped without drain, with a warning, flag or not', async t => {
  for (const args of [['stop'], ['stop', '--allow-legacy-restart']]) {
    const f = fixture(t)
    const warnings = []
    assert.equal(await runLauncher(args, { ...f.options, warn: message => warnings.push(String(message)) }), 0)
    assert.deepEqual(f.calls.find(([name]) => name === 'stop')[1].expectedIdentity, owned(identity()))
    assert.ok(warnings.some(line => /无 Pet 停止凭据.*启动恢复/.test(line)), warnings.join('\n'))
  }
})

test('an old noPet snapshot and mutable manifest never replace authenticated status', async t => {
  const f = fixture(t)
  const dir = path.join(f.home, 'run/dsh-host-launch')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(dir, '40001.json'), JSON.stringify({ v: 1, source: 'host-runtime', port: 40001, profile: 'web', pet: false, bootId: 'fake-runtime-boot', identity: identity() }), { mode: 0o600 })
  // The snapshot authorizes nothing; with no descriptor the stop proceeds without drain.
  assert.equal(await runLauncher(['stop'], f.options), 0)
  assert.equal(f.calls.some(([name]) => name === 'prepare'), false)
})

test('every signal rechecks authenticated prepared and operationNonce', async t => {
  for (const delta of [{ phase: 'active' }, { operationNonce: null }, { operationNonce: 'wrong' }, { hostPid: 1 }, { bootId: 'wrong' }, { nonce: 'wrong' }, { preparedAt: 1 }, { expiresAt: Date.now() + 100000 }]) await t.test(JSON.stringify(delta), async t => {
    const f = await petFixture(t, { status: ({ data }) => ({ ok: true, data: { ...data, ...delta } }) })
    const ticket = await f.prepare()
    const signals = []
    const result = await stopServer(f.port, { expectedIdentity: f.initial, beforeSignal: ticket.beforeSignal, probe: f.options.probe, signal: async (...args) => signals.push(args) })
    assert.equal(result.ok, false)
    assert.deepEqual(signals, [])
    assert.equal(await ticket.resume(), 'resumed')
  })
})

test('replacement protocol confirmation uses authenticated active status and never prepares or drains', async t => {
  const f = await petFixture(t)
  await verifyStopProtocol({ home: f.home, port: f.port, initial: f.initial, probe: f.options.probe })
  assert.deepEqual(f.requests.map(req => [req.method, req.body?.action]), [['GET', undefined], ['POST', 'status']])
  for (const delta of [{ phase: 'prepared' }, { operationNonce: 'old-operation' }, { operationNonce: undefined }, { bootId: 'old-boot' }, { hostPid: 1 }]) await t.test(JSON.stringify(delta), async t => {
    const f = await petFixture(t, { status: ({ data }) => ({ ok: true, data: { ...data, ...delta } }) })
    await assert.rejects(verifyStopProtocol({ home: f.home, port: f.port, initial: f.initial, probe: f.options.probe }), /replacement|unverified|another/)
    assert.equal(f.requests.some(req => req.body?.action === 'prepare'), false)
  })
})

test('legacy restart only announces protocol loaded after the replacement authenticates active status', async t => {
  for (const active of [true, false]) await t.test(String(active), async t => {
    const f = await petFixture(t)
    let released = false
    f.options.connect = async () => true
    f.options.spawn = () => {
      const child = new EventEmitter()
      Object.assign(child, { pid: f.current.pid, exitCode: null, signalCode: null, unref: () => { released = true } })
      f.current = { ...f.current, created: 'replacement-creation-time' }
      f.descriptor.bootId = 'replacement-boot-id'
      fs.writeFileSync(f.file, JSON.stringify(f.descriptor))
      f.prepared = active ? undefined : { ...f.prepared, bootId: f.descriptor.bootId }
      return child
    }
    if (active) {
      assert.equal(await runLauncher(['restart', '--allow-legacy-restart', '--no-open'], f.options), 0)
      assert(f.logs.some(line => /descriptor.*status.*确认/.test(line)))
      assert(f.logs.some(line => /维护.*不计.*drain/.test(line)))
    } else {
      await assert.rejects(runLauncher(['restart', '--allow-legacy-restart', '--no-open'], f.options), /协议尚未确认.*维护不计为 drained/)
      assert.equal(f.logs.some(line => /dsh 已启动/.test(line)), false)
    }
    assert.equal(released, true, 'release only the fake replacement child handle')
  })
})

test('stopServer binds to the identity probed before the handshake and never adopts the replacement Host', async () => {
  for (const change of [{ pid: 43434 }, { created: 'boot-time-2' }, { argv: [...identity().argv, '--host', 'localhost'] }, { executable: '/another/node' }]) {
    const signals = []; let reads = 0
    const result = await stopServer(40001, { expectedIdentity: owned(identity()), probe: async () => ++reads < 3 ? owned(identity(change)) : { state: 'empty', processes: [] },
      connect: async () => false, signal: async (...args) => signals.push(args) })
    assert.equal(result.ok, false, JSON.stringify(change))
    assert.deepEqual(signals, [], JSON.stringify(change))
  }
})
