import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveCliBin } from '../scripts/lib/dsh-cli.mjs'

/**
 * Acceptance gate for the node-connection orchestration added to `apply()`.
 *
 * A real `dsh web` runs as the "remote", reachable ONLY through a real system
 * OpenSSH loopback tunnel. `apply()` must connect it, structurally probe it,
 * publish it as READY/SUPPORTED in the inventory, and serve a REAL baseline
 * (the workspace/session created on the remote's own server).
 *
 * Nothing touches `~/.dsh`; no deployment runs.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const SSH = '/usr/bin/ssh'

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8' })

function dshInvocation() {
  const resolved = resolveCliBin({
    spec: '@deepseek-ai/dsh@0.1.1-rc.2',
    version: '0.1.1-rc.2',
    installProbe: false,
  })
  if (resolved === null) return undefined
  return resolved.kind === 'env'
    ? { command: resolved.bin, prefixArgs: [] }
    : { command: process.execPath, prefixArgs: [resolved.bin] }
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
      if ((await rpc(port, 'host.describe', {}))?.result?.ok === true) return
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('rc.2 /api never became ready')
}

async function startSshd(root, username) {
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
    `  User ${username}`,
    `  IdentityFile ${clientKey}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${knownHosts}`,
    '  StrictHostKeyChecking yes',
    '',
  ].join('\n'), { mode: 0o600 })
  // The production manager accepts an executable path (not arbitrary args).
  // A tiny wrapper keeps that contract while injecting this fixture's isolated
  // OpenSSH config; production still uses `/usr/bin/ssh` and the user's config.
  const sshWrapper = path.join(dir, 'ssh-wrapper')
  await writeFile(sshWrapper, `#!/bin/sh\nexec ${SSH} -F ${sshConfig} "$@"\n`, { mode: 0o700 })
  return { sshd, sshConfig, sshWrapper }
}

async function buildFederation(root) {
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, `export * from ${JSON.stringify(path.join(PKG, 'src/index.ts'))}\n`)
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-connectivity-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`)
  assert.equal(run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--packages=external',
    `--outfile=${bundle}`, '--log-level=error',
  ]).status, 0)
  return { mod: await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`), bundle }
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

test('apply() connects a real remote through a real tunnel and serves its real baseline', { timeout: 600_000 }, async t => {
  const dsh = dshInvocation()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-connectivity-'))
  const bundles = []
  let remote
  let sshd
  let httpServer
  let cordisFiber
  try {
    // 1) A real remote `dsh web` with its own home, and a seeded session.
    const remoteHome = path.join(root, 'remote-home')
    const remoteCwd = path.join(root, 'remote-project')
    await mkdir(remoteHome, { recursive: true })
    await mkdir(remoteCwd, { recursive: true })
    const remotePort = await freePort()
    remote = spawn(dsh.command, [...dsh.prefixArgs, 'web', '--port', String(remotePort), '--no-open'], {
      cwd: remoteCwd, stdio: 'ignore', env: { ...process.env, DSH_HOME: remoteHome, DSH_SKIP_UPDATE: '1' },
    })
    await apiReady(remotePort, remote)
    const ws = await rpc(remotePort, 'workspace.create', { path: remoteCwd })
    const nativeWorkspaceId = ws.result.value.workspaceId
    const ss = await rpc(remotePort, 'session.create', { workspaceId: nativeWorkspaceId })
    const nativeSessionId = ss.result.value.sessionId
    await rpc(remotePort, 'session.rename', { sessionId: nativeSessionId, title: 'seeded-on-remote' })

    // 2) A real sshd so the only path to the remote is a system OpenSSH tunnel.
    sshd = await startSshd(root, process.env.USER)

    // 3) Registry with ONE enabled remote pointing at the tunnel alias.
    const { mod: fed, bundle } = await buildFederation(root)
    bundles.push(bundle)
    const home = path.join(root, 'central-home')
    await mkdir(home, { recursive: true })
    const storage = new fed.NodeRegistryStorage(home)
    let snapshot = fed.NodeRegistryModel.create(fed.parseNodeId('this-mac')).snapshot
    await storage.save(snapshot, 'missing')
    const model = new fed.NodeRegistryModel(snapshot)
    snapshot = await storage.save(model.addRemote({
      nodeId: fed.parseNodeId('vm-remote'),
      displayName: 'VM Remote',
      sshAlias: 'fixture-remote',
      remoteDshPort: remotePort,
    }), snapshot.generation)

    // 4) The wrapped gateway: patched Connection route + real apply().
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
    assert.ok(route)

    const nativeChain = { fetch: async () => new Response('{"routed":"native"}', { status: 200 }) }
    const connection = ctx.get('connection')
    const originalUse = connection.api.use.bind(connection.api)
    Object.defineProperty(connection, 'api', {
      configurable: true,
      get: () => ({ use: middleware => originalUse(async (request, _next) => middleware(request, nativeChain)) }),
    })
    cordisFiber = ctx.inject(['connection'], child => { fed.apply(child, { dshHome: home, sshExecutable: sshd.sshWrapper }) })

    // 5) Poll until the remote is READY in the inventory: this is the whole
    //    point — apply() must build the tunnel and probe on its own.
    const post = async (pathname, payload) => {
      const response = await fetch(`http://127.0.0.1:${httpServer.address().port}${pathname}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `b-${pathname}`, ...payload }),
      })
      return response.json()
    }
    const serverProbe = createServer((req, res) => { void route.handler(req, res) })
    httpServer = serverProbe
    await new Promise(resolve => serverProbe.listen(0, '127.0.0.1', resolve))

    let inventory
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/nodes`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'b-nodes', method: 'federation/nodes', payload: {} }),
      })
      const text = await response.text()
      const body = (() => { try { return JSON.parse(text) } catch { return undefined } })()
      const nodes = body?.result?.value?.nodes
      if (Array.isArray(nodes)) {
        inventory = nodes
        if (nodes.some(node => node.nodeId === 'vm-remote' && node.state === 'READY')) break
      }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.ok(inventory, 'inventory never became available')
    const remoteNode = inventory.find(node => node.nodeId === 'vm-remote')
    assert.ok(remoteNode, JSON.stringify(inventory))
    assert.equal(remoteNode.state, 'READY', `remote must be connected: ${JSON.stringify(inventory)}`)
    assert.equal(remoteNode.compatibility, 'SUPPORTED', JSON.stringify(inventory))
    assert.equal(remoteNode.displayName, 'VM Remote')
    assert.equal(remoteNode.kind, 'remote')

    // 6) The baseline must be the REMOTE's REAL data, not an empty tree.
    const baselineResponse = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/baseline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'b-base', method: 'federation/baseline', payload: { nodeId: 'vm-remote' } }),
    })
    const baselineBody = await baselineResponse.json()
    const baseline = baselineBody?.result?.value
    if (baseline === undefined) {
      const diagnosticResponse = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/nodes`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'b-nodes-diagnostic', method: 'federation/nodes', payload: {} }),
      })
      const diagnostic = await diagnosticResponse.json()
      assert.fail(`no baseline: ${JSON.stringify(baselineBody)} inventory=${JSON.stringify(diagnostic)}`)
    }
    const sessions = baseline.sessions ?? []
    const titles = sessions.map(session => session.title)
    assert.ok(titles.includes('seeded-on-remote'),
      `baseline must contain the remote's real session: ${JSON.stringify(titles)}`)
    assert.ok((baseline.workspaces ?? []).length >= 1, 'baseline must contain the remote workspace')

    // 7) The local machine must still report honest (non-connected) facts.
    const localNode = inventory.find(node => node.nodeId === 'this-mac')
    assert.equal(localNode.kind, 'local')
    assert.equal(localNode.enabled, true)

    // 8) Both WebSocket streams stay owned by the connection lifecycle. Killing
    // the remote closes them; the node must leave READY and its router port must
    // disappear instead of serving a stale tree as writable/online.
    remote.kill('SIGKILL')
    await new Promise(resolve => remote.once('exit', resolve))
    let disconnectedNode
    for (let attempt = 0; attempt < 80; attempt++) {
      const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/nodes`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'b-nodes-after-disconnect', method: 'federation/nodes', payload: {} }),
      })
      const body = await response.json()
      disconnectedNode = body?.result?.value?.nodes?.find(node => node.nodeId === 'vm-remote')
      if (disconnectedNode && disconnectedNode.state !== 'READY') break
      await new Promise(resolve => setTimeout(resolve, 125))
    }
    assert.notEqual(disconnectedNode?.state, 'READY', JSON.stringify(disconnectedNode))

    const staleBaselineResponse = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/baseline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'b-base-stale', method: 'federation/baseline', payload: { nodeId: 'vm-remote' } }),
    })
    assert.notEqual(staleBaselineResponse.status, 200,
      'a disconnected node must not continue serving its baseline as live')

    // Restart only the remote Host with the same durable home and port. The
    // central Host must reconnect its own tunnel/WebSocket generation without a
    // restart and recover the persisted baseline.
    remote = spawn(dsh.command, [...dsh.prefixArgs, 'web', '--port', String(remotePort), '--no-open'], {
      cwd: remoteCwd, stdio: 'ignore', env: { ...process.env, DSH_HOME: remoteHome, DSH_SKIP_UPDATE: '1' },
    })
    await apiReady(remotePort, remote)
    let recoveredNode
    for (let attempt = 0; attempt < 240; attempt++) {
      const response = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/nodes`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'b-nodes-recovered', method: 'federation/nodes', payload: {} }),
      })
      const body = await response.json()
      recoveredNode = body?.result?.value?.nodes?.find(node => node.nodeId === 'vm-remote')
      if (recoveredNode?.state === 'READY') break
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    assert.equal(recoveredNode?.state, 'READY', JSON.stringify(recoveredNode))
    const recoveredResponse = await fetch(`http://127.0.0.1:${httpServer.address().port}/api/federation/baseline`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'b-base-recovered', method: 'federation/baseline', payload: { nodeId: 'vm-remote' } }),
    })
    const recovered = (await recoveredResponse.json())?.result?.value
    assert.ok(recovered.sessions.some(session => session.displayTitle === 'seeded-on-remote'), JSON.stringify(recovered))
  } finally {
    await cordisFiber?.dispose?.()
    if (httpServer) await new Promise(resolve => httpServer.close(resolve))
    for (const bundle of bundles) await rm(bundle, { force: true })
    // A child terminated by signal keeps exitCode === null and records
    // signalCode instead. Never wait for a second `exit` event that already ran.
    if (remote?.exitCode === null && remote?.signalCode === null) {
      remote.kill('SIGKILL')
      await new Promise(resolve => remote.once('exit', resolve))
    }
    if (sshd?.sshd?.exitCode === null && sshd?.sshd?.signalCode === null) {
      sshd.sshd.kill('SIGTERM')
      await new Promise(resolve => sshd.sshd.once('exit', resolve))
    }
    await rm(root, { recursive: true, force: true })
  }
})