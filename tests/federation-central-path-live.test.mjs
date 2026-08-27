import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openRealRc2Streams } from './helpers/rc2-stream-proof.mjs'

/**
 * The complete central request path, composed once, end to end:
 *
 *   HTTP client
 *     → patched rc.2 Connection `/api` route (real Host/Origin fence)
 *       → federation outer middleware (sole `/api` seam)
 *         → CentralUplink (identity → owner → capability)
 *           → CommandRouter → DshRc2NodeAdapter → HttpUnaryCarrier
 *             → real `dsh web` (local in-process, remote over real SSH tunnel)
 *
 * Every other test covers one link. This one proves they compose: a federated
 * id reaches the correct real server, a bare native id falls through to the
 * local composed handler, and a forged id is rejected before either.
 *
 * Nothing touches `~/.dsh`; no deployment runs.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const SSH = '/usr/bin/ssh'

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8' })

function dshBin() {
  const candidate = path.join(process.env.HOME ?? '', '.npm/_npx/de4831d60afe10da/node_modules/.bin/dsh')
  const probe = run(candidate, ['--version'])
  return probe.status === 0 || probe.stdout ? candidate : undefined
}

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close(error => (error ? reject(error) : resolve(port)))
  })
})

async function waitTcp(port) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const open = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false))
    })
    if (open) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`port ${port} never opened`)
}

async function rpc(port, method, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `c-${method}`, method, payload }),
  })
  return response.json()
}

async function apiReady(port, child) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`dsh web exited early: ${child.exitCode}`)
    try {
      const parsed = await rpc(port, 'host.describe', {})
      if (parsed?.result?.ok === true) return
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('rc.2 /api never became ready')
}

async function startSshd(root) {
  const dir = path.join(root, 'ssh')
  await mkdir(dir, { mode: 0o700, recursive: true })
  const hostKey = path.join(dir, 'host_ed25519')
  const clientKey = path.join(dir, 'client_ed25519')
  for (const target of [hostKey, clientKey]) {
    assert.equal(run(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', target]).status, 0)
  }
  const authorized = path.join(dir, 'authorized_keys')
  await writeFile(authorized, await readFile(`${clientKey}.pub`), { mode: 0o600 })
  const port = await freePort()
  const config = path.join(dir, 'sshd_config')
  await writeFile(config, [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`,
    `AuthorizedKeysFile ${authorized}`, 'PasswordAuthentication no',
    'KbdInteractiveAuthentication no', 'UsePAM no', 'PermitRootLogin no',
    'AllowTcpForwarding yes', 'PermitOpen 127.0.0.1:*', 'StrictModes no', 'LogLevel ERROR',
  ].join('\n'))
  const sshd = spawn(SSHD, ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] })
  await waitTcp(port)
  const knownHosts = path.join(dir, 'known_hosts')
  const hostPublic = (await readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${hostPublic}\n`, { mode: 0o600 })
  const sshConfig = path.join(dir, 'config')
  await writeFile(sshConfig, [
    'Host fixture-remote',
    '  HostName 127.0.0.1',
    `  Port ${port}`,
    `  User ${process.env.USER}`,
    `  IdentityFile ${clientKey}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${knownHosts}`,
    '  StrictHostKeyChecking yes',
    '',
  ].join('\n'), { mode: 0o600 })
  return { sshd, sshConfig }
}

async function openTunnel(sshConfig, remotePort) {
  const localPort = await freePort()
  const child = spawn(SSH, [
    '-F', sshConfig, '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=5', '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, '--', 'fixture-remote',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 300) })
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`ssh exited: ${stderr}`)
    try {
      if ((await rpc(localPort, 'host.describe', {}))?.result?.ok === true) return { child, localPort }
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 125))
  }
  throw new Error(`tunnel never served DSH: ${stderr}`)
}

async function buildConnection(root) {
  assert.equal(run(process.execPath, [
    path.join(REPO, 'scripts/fetch-rc2-connection-source.mjs'),
    '--cache-dir', path.join(root, 'cache'), '--output-dir', path.join(root, 'source'),
  ]).status, 0)
  assert.equal(run(process.execPath, [
    path.join(REPO, 'scripts/build-rc2-connection-compat.mjs'),
    '--source-dir', path.join(root, 'source/deepseek-harness-b150a551'),
    '--output-dir', path.join(root, 'connection'),
  ]).status, 0)
  await symlink(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const bundle = path.join(root, 'connection.mjs')
  assert.equal(run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(root, 'connection/src/index.ts'), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${bundle}`,
  ]).status, 0)
  return import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
}

test('the whole central path routes a federated id to its real remote server', { timeout: 600_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-central-'))
  const servers = []
  let tunnel
  let sshd
  let httpServer
  let federationBundle
  const streamCarriers = []
  try {
    // Two real DSH servers with independent state: "this-mac" and a remote.
    for (const id of ['this-mac', 'vm-remote']) {
      const home = path.join(root, `${id}-home`)
      const cwd = path.join(root, `${id}-project`)
      await mkdir(home, { recursive: true })
      await mkdir(cwd, { recursive: true })
      const port = await freePort()
      const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
        cwd, stdio: 'ignore', env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },
      })
      servers.push({ id, child, port, cwd })
    }
    for (const server of servers) await apiReady(server.port, server.child)
    const localServer = servers[0]
    const remoteServer = servers[1]

    // The remote is reachable only through a real system-OpenSSH tunnel.
    sshd = await startSshd(root)
    tunnel = await openTunnel(sshd.sshConfig, remoteServer.port)

    // Real federation host code.
    // ONE bundle for host+core, mirroring the deployed `lib/index.js`, which
    // re-exports both from relative paths and therefore shares a single module
    // instance. Bundling them separately would duplicate the error classes and
    // break `instanceof` classification in the uplink — an artifact of the
    // fixture, not of the product.
    federationBundle = path.join(REPO, 'node_modules/.cache', `federation-central-${process.pid}.mjs`)
    const entry = path.join(root, 'federation-entry.ts')
    await writeFile(entry, [
      `export * from ${JSON.stringify(path.join(PKG, 'src/core/index.ts'))}`,
      `export * from ${JSON.stringify(path.join(PKG, 'src/host/index.ts'))}`,
      '',
    ].join('\n'))
    assert.equal(run(path.join(REPO, 'node_modules/.bin/esbuild'), [
      entry, '--bundle', '--format=esm', '--platform=node',
      `--outfile=${federationBundle}`, '--log-level=error',
    ]).status, 0)
    const fed = await import(`${pathToFileURL(federationBundle).href}?v=${Date.now()}`)
    const {
      CentralUplink, CommandRouter, DshRc2NodeAdapter, HttpUnaryCarrier,
      encodeSessionId, encodeWorkspaceId, parseNodeId,
    } = fed

    // Build one real adapter per node and seed distinguishable state.
    const nodeIds = { local: parseNodeId('this-mac'), remote: parseNodeId('vm-remote') }
    const ports = new Map()
    const natives = {}
    for (const [kind, server, endpointPort] of [
      ['local', localServer, localServer.port],
      ['remote', remoteServer, tunnel.localPort],
    ]) {
      const carrier = new HttpUnaryCarrier({
        endpoint: new URL(`http://127.0.0.1:${endpointPort}`), generation: 1, currentGeneration: () => 1, timeoutMs: 30_000,
      })
      const streams = await openRealRc2Streams(fed, new URL(`http://127.0.0.1:${endpointPort}`))
      streamCarriers.push(streams)
      const probe = await DshRc2NodeAdapter.probe(carrier, streams.proof)
      assert.equal(probe.compatibility, 'SUPPORTED', `${server.id}: ${probe.diagnostic}`)
      const adapter = new DshRc2NodeAdapter({
        nodeId: nodeIds[kind], kind: kind === 'local' ? 'local' : 'remote',
        displayName: server.id, enabled: true, order: kind === 'local' ? 0 : 1,
        capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
        ...(kind === 'remote' ? { sshAlias: 'fixture-remote', remoteDshPort: remoteServer.port } : {}),
      }, carrier, probe.capabilities)
      const workspace = await adapter.createWorkspace(server.cwd)
      const sessionId = await adapter.createSession(workspace.ref.nativeId)
      await adapter.renameSession(sessionId, `seeded-on-${server.id}`)
      ports.set(nodeIds[kind], adapter)
      natives[kind] = { workspace: workspace.ref.nativeId, session: sessionId, adapter }
    }

    const uplink = new CentralUplink(
      new CommandRouter(ports),
      new Set([nodeIds.local, nodeIds.remote]),
      nodeIds.local,
    )

    // Patched Connection with the federation middleware as its sole `/api` seam.
    const connectionModule = await buildConnection(root)
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    ctx.provide('webServer', undefined, true)
    let route
    ctx.webServer = {
      register(registered) { route = registered; return () => {} },
      registerUpgrade() { return () => {} },
    }
    connectionModule.apply(ctx, { trustedHosts: [] })
    assert.ok(route, 'the patched Connection must register its /api route')

    // The local composed handler stands in for the native fallback chain: it is
    // reached only when the uplink declines a request.
    const nativeCalls = []
    const owner = ctx.inject(['connection'], child => {
      child.connection.api.use(async request => {
        const pathname = new URL(request.url).pathname
        const envelope = await request.clone().json().catch(() => ({}))
        const payload = envelope?.type === 'client-request' && envelope?.method === pathname.slice('/api/'.length)
          ? envelope.payload
          : envelope
        const outcome = await uplink.handle({ path: pathname, rpcId: envelope?.rpcId ?? 'central-1', payload })
        if (outcome.kind === 'ok') return Response.json({ routed: 'federation', value: outcome.value ?? null })
        if (outcome.kind === 'error') {
          return Response.json({ routed: 'rejected', code: outcome.code }, { status: outcome.status })
        }
        nativeCalls.push(pathname)
        // Bare native ids belong to This Mac: forward to its real server.
        const parsed = await rpc(localServer.port, pathname.slice('/api/'.length), payload)
        return Response.json({ routed: 'native', ok: parsed?.result?.ok === true })
      })
    })
    await new Promise(resolve => setTimeout(resolve, 200))

    httpServer = createServer((req, res) => { void route.handler(req, res) })
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const gatewayPort = httpServer.address().port
    let browserRpc = 0
    const post = async (pathname, payload, headers = {}) => {
      const method = pathname.slice('/api/'.length)
      const response = await fetch(`http://127.0.0.1:${gatewayPort}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ type: 'client-request', rpcId: `central-browser-${++browserRpc}`, method, payload }),
      })
      return { status: response.status, body: await response.json().catch(() => ({})) }
    }

    // 1) A federated remote id must reach the REAL remote server.
    const remoteSession = encodeSessionId({ nodeId: nodeIds.remote, nativeId: natives.remote.session })
    const renamed = await post('/api/session.rename', { sessionId: remoteSession, title: 'renamed-through-central-path' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed))
    assert.equal(renamed.body.routed, 'federation', JSON.stringify(renamed.body))

    // Verified on the remote's own server, independently of the central path.
    const remoteList = await natives.remote.adapter.listSessions()
    assert.ok(remoteList.some(session => session.title === 'renamed-through-central-path'),
      `remote did not apply the write: ${JSON.stringify(remoteList.map(s => s.title))}`)
    // The local node must be untouched.
    const localList = await natives.local.adapter.listSessions()
    assert.deepEqual(localList.map(session => session.title), ['seeded-on-this-mac'],
      'a remote-owned command must not touch This Mac')

    // Browser envelope → Connection → Uplink → Router → real rc.2 reorder.
    const secondNative = await natives.remote.adapter.createSession(natives.remote.workspace)
    const secondSession = encodeSessionId({ nodeId: nodeIds.remote, nativeId: secondNative })
    const remoteWorkspace = encodeWorkspaceId({ nodeId: nodeIds.remote, nativeId: natives.remote.workspace })
    const reordered = await post('/api/workspace.insertSessionBefore', {
      workspaceId: remoteWorkspace, sessionId: secondSession, beforeSessionId: remoteSession,
    })
    assert.equal(reordered.status, 200, JSON.stringify(reordered))
    const reorderedWorkspace = (await natives.remote.adapter.listWorkspaces())
      .find(workspace => workspace.ref.nativeId === natives.remote.workspace)
    assert.deepEqual(reorderedWorkspace?.sessionIds, [secondSession, remoteSession],
      'the remote authoritative workspace must persist browser-requested session order')

    // 2) A bare native id falls through to the local composed handler.
    nativeCalls.length = 0
    const native = await post('/api/session.rename', { sessionId: natives.local.session, title: 'renamed-locally' })
    assert.equal(native.body.routed, 'native', JSON.stringify(native.body))
    assert.deepEqual(nativeCalls, ['/api/session.rename'])
    const localAfter = await natives.local.adapter.listSessions()
    assert.deepEqual(localAfter.map(session => session.title), ['renamed-locally'])

    // 3) A forged/unknown node id is rejected before any server is contacted.
    nativeCalls.length = 0
    const forged = await post('/api/session.rename', { sessionId: 'fed1:ghost:s:c2Vzc2lvbg', title: 'nope' })
    assert.equal(forged.body.routed, 'rejected', JSON.stringify(forged.body))
    assert.equal(forged.body.code, 'federation-id-unknown-node')
    assert.deepEqual(nativeCalls, [], 'a forged id must never reach the native fallback')

    // 4) Cross-node workspace anchors are refused at the uplink.
    const crossNode = await post('/api/workspace.insertBefore', {
      workspaceId: encodeWorkspaceId({ nodeId: nodeIds.remote, nativeId: natives.remote.workspace }),
      beforeWorkspaceId: encodeWorkspaceId({ nodeId: nodeIds.local, nativeId: natives.local.workspace }),
    })
    assert.equal(crossNode.body.routed, 'rejected', JSON.stringify(crossNode.body))
    assert.equal(crossNode.body.code, 'federation-capability-denied')

    // 5) The trust fence still guards the whole composition.
    const untrusted = await fetch(`http://127.0.0.1:${gatewayPort}/api/session.rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      body: JSON.stringify({ sessionId: remoteSession, title: 'attacker' }),
    })
    assert.equal(untrusted.status, 403, 'cross-site requests must be rejected before federation')
    const stillNamed = await natives.remote.adapter.listSessions()
    assert.ok(stillNamed.some(session => session.title === 'renamed-through-central-path'),
      'a rejected cross-site request must not have mutated the remote')

    await owner.dispose()
  } finally {
    streamCarriers.forEach(streams => streams.dispose())
    if (httpServer) await new Promise(resolve => httpServer.close(resolve))
    if (tunnel?.child?.exitCode === null) tunnel.child.kill('SIGKILL')
    for (const server of servers) {
      server.child.kill('SIGKILL')
      await new Promise(resolve => server.child.once('exit', resolve))
    }
    if (sshd?.sshd?.exitCode === null) sshd.sshd.kill('SIGTERM')
    if (federationBundle) await rm(federationBundle, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
