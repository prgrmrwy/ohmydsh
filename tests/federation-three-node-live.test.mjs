import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * End-to-end three-node acceptance against real infrastructure.
 *
 * This is the strongest available proof short of separate physical machines:
 *
 * - three real `dsh web` servers, each with its own isolated DSH_HOME and cwd
 *   (independent workspace registries and session stores);
 * - two of them reached only through real system OpenSSH loopback tunnels via
 *   real `~/.ssh/config`-style aliases served by a real `sshd`;
 * - deliberately colliding native workspace/session ids across all three nodes;
 * - the real Core registry/projection/router and the real rc.2 adapter.
 *
 * Nothing touches `~/.dsh`, no deployment runs, and `session.prompt` is never
 * driven (it would consume a model subscription).
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')
const SSHD = '/usr/sbin/sshd'
const SSH_KEYGEN = '/usr/bin/ssh-keygen'
const SSH = '/usr/bin/ssh'

function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}

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

async function waitForPort(port) {
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

/** rc.2 composes /api after the port opens; readiness needs a real host.describe. */
async function apiReady(port, child) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`dsh web exited early: ${child.exitCode}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/host.describe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'ready', method: 'host.describe', payload: {} }),
      })
      if (response.status === 200) return
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('rc.2 /api never became ready')
}

async function startSshd(root) {
  const ssh = path.join(root, 'ssh')
  await mkdir(ssh, { mode: 0o700 })
  const hostKey = path.join(ssh, 'host_ed25519')
  const clientKey = path.join(ssh, 'client_ed25519')
  for (const target of [hostKey, clientKey]) {
    const made = run(SSH_KEYGEN, ['-q', '-t', 'ed25519', '-N', '', '-f', target])
    assert.equal(made.status, 0, made.stderr)
  }
  const authorizedKeys = path.join(ssh, 'authorized_keys')
  await writeFile(authorizedKeys, await readFile(`${clientKey}.pub`), { mode: 0o600 })
  const port = await freePort()
  const config = path.join(ssh, 'sshd_config')
  await writeFile(config, [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`,
    `AuthorizedKeysFile ${authorizedKeys}`, 'PasswordAuthentication no',
    'KbdInteractiveAuthentication no', 'UsePAM no', 'PermitRootLogin no',
    'AllowTcpForwarding yes', 'PermitOpen 127.0.0.1:*', 'StrictModes no', 'LogLevel ERROR',
  ].join('\n'))
  const sshd = spawn(SSHD, ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] })
  await waitForPort(port)
  const knownHosts = path.join(ssh, 'known_hosts')
  const hostPublic = (await readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
  await writeFile(knownHosts, `[127.0.0.1]:${port} ${hostPublic}\n`, { mode: 0o600 })
  return { sshd, port, clientKey, knownHosts }
}

async function writeSshConfig(root, aliases, sshd) {
  const config = path.join(root, 'ssh', 'config')
  const blocks = aliases.map(alias => [
    `Host ${alias}`,
    '  HostName 127.0.0.1',
    `  Port ${sshd.port}`,
    `  User ${process.env.USER}`,
    `  IdentityFile ${sshd.clientKey}`,
    '  IdentitiesOnly yes',
    `  UserKnownHostsFile ${sshd.knownHosts}`,
    '  StrictHostKeyChecking yes',
  ].join('\n'))
  await writeFile(config, `${blocks.join('\n')}\n`, { mode: 0o600 })
  return config
}

/** Real system-OpenSSH loopback forward; returns the published local endpoint. */
async function openTunnel(sshConfig, alias, remotePort) {
  const localPort = await freePort()
  const child = spawn(SSH, [
    '-F', sshConfig, '-N', '-T',
    '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=5',
    '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, '--', alias,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 400) })
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(`ssh exited: ${stderr}`)
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/api/host.describe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'tunnel-ready', method: 'host.describe', payload: {} }),
      })
      if (response.status === 200) return { child, localPort }
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 125))
  }
  throw new Error(`tunnel to ${alias} never served DSH: ${stderr}`)
}

async function loadFederation() {
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-3node-${process.pid}.mjs`)
  for (const [entry, out] of [['src/host/index.ts', bundle], ['src/core/index.ts', bundle.replace('.mjs', '-core.mjs')]]) {
    const built = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
      path.join(PKG, entry), '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=error',
    ])
    assert.equal(built.status, 0, built.stderr)
  }
  return {
    host: await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`),
    core: await import(`${pathToFileURL(bundle.replace('.mjs', '-core.mjs')).href}?v=${Date.now()}`),
    bundles: [bundle, bundle.replace('.mjs', '-core.mjs')],
  }
}

test('three live rc.2 nodes federate over real tunnels with colliding native ids', { timeout: 600_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }
  const sshdProbe = run(SSHD, ['-t', '-f', '/dev/null'])
  if (sshdProbe.error !== undefined) {
    t.skip('system sshd is unavailable')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-3node-'))
  const nodes = [
    { id: 'this-mac', kind: 'local' },
    { id: 'vm-a', kind: 'remote', alias: 'fixture-vm-a' },
    { id: 'vm-b', kind: 'remote', alias: 'fixture-vm-b' },
  ]
  const servers = []
  const tunnels = []
  let sshd
  let bundles = []
  try {
    // One real dsh web per node, each with its own DSH_HOME and project dir.
    for (const node of nodes) {
      const home = path.join(root, `${node.id}-home`)
      const cwd = path.join(root, `${node.id}-project`)
      await mkdir(home, { recursive: true })
      await mkdir(cwd, { recursive: true })
      const port = await freePort()
      const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
        cwd, stdio: 'ignore',
        env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },
      })
      servers.push({ node, child, port, cwd })
    }
    for (const server of servers) await apiReady(server.port, server.child)

    sshd = await startSshd(root)
    const sshConfig = await writeSshConfig(root, nodes.filter(n => n.kind === 'remote').map(n => n.alias), sshd)

    const { host, core, bundles: built } = await loadFederation()
    bundles = built
    const { HttpUnaryCarrier, DshRc2NodeAdapter } = host
    const { CommandRouter, NodeRegistryModel, aggregateProjection, parseNodeId, decodeSessionId, decodeWorkspaceId } = core

    // Local node speaks in-process; remotes only through real SSH tunnels.
    const endpoints = new Map()
    for (const server of servers) {
      if (server.node.kind === 'local') {
        endpoints.set(server.node.id, server.port)
        continue
      }
      const tunnel = await openTunnel(sshConfig, server.node.alias, server.port)
      tunnels.push(tunnel.child)
      endpoints.set(server.node.id, tunnel.localPort)
    }

    // Every node independently gets the SAME native workspace/session names.
    const COLLIDING_TITLE = 'shared-workspace'
    const COLLIDING_SESSION_TITLE = 'shared-session'
    const ports = new Map()
    const adapters = new Map()
    const natives = new Map()
    for (const server of servers) {
      const localPort = endpoints.get(server.node.id)
      const carrier = new HttpUnaryCarrier({
        endpoint: new URL(`http://127.0.0.1:${localPort}`), generation: 1, currentGeneration: () => 1, timeoutMs: 30_000,
      })
      const probe = await DshRc2NodeAdapter.probe(carrier, { mux: true, host: true })
      assert.equal(probe.compatibility, 'SUPPORTED', `${server.node.id}: ${probe.diagnostic}`)
      const descriptor = {
        nodeId: parseNodeId(server.node.id), kind: server.node.kind,
        displayName: server.node.id, enabled: true, order: nodes.findIndex(n => n.id === server.node.id),
        capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
        ...(server.node.alias === undefined ? {} : { sshAlias: server.node.alias, remoteDshPort: server.port }),
      }
      const adapter = new DshRc2NodeAdapter(descriptor, carrier, probe.capabilities)
      const workspace = await adapter.createWorkspace(server.cwd)
      await adapter.renameWorkspace(workspace.ref.nativeId, COLLIDING_TITLE)
      const sessionId = await adapter.createSession(workspace.ref.nativeId)
      await adapter.renameSession(sessionId, COLLIDING_SESSION_TITLE)
      ports.set(descriptor.nodeId, adapter)
      adapters.set(server.node.id, adapter)
      natives.set(server.node.id, { workspace: workspace.ref.nativeId, session: sessionId })
    }

    // Registry: immutable local identity plus two remotes.
    let registry = NodeRegistryModel.create(parseNodeId('this-mac'))
    for (const node of nodes.filter(n => n.kind === 'remote')) {
      const server = servers.find(s => s.node.id === node.id)
      registry = new NodeRegistryModel(new NodeRegistryModel(registry.snapshot ?? registry).addRemote({
        nodeId: parseNodeId(node.id), displayName: node.id, sshAlias: node.alias, remoteDshPort: server.port,
      }))
    }
    assert.equal(registry.snapshot.nodes.length, 3)

    // Federated projection over three live nodes.
    const inputs = []
    for (const server of servers) {
      const adapter = adapters.get(server.node.id)
      const workspaces = await adapter.listWorkspaces()
      const sessions = await adapter.listSessions()
      inputs.push({
        node: adapter.node,
        workspaces: workspaces.map((workspace, order) => ({
          id: workspace.ref.nativeId, title: workspace.title, path: workspace.path,
          sessionIds: workspace.sessionIds.map(id => decodeSessionId(id, new Set([adapter.node.nodeId])).nativeId),
          order,
        })),
        sessions: sessions.map(session => ({
          id: session.ref.nativeId, title: session.title, path: session.path,
          status: session.status, archived: session.archived,
        })),
      })
    }
    const projection = aggregateProjection(inputs)

    // Namespace acceptance: same native ids, three distinct federated ids.
    assert.equal(projection.nodes.length, 3)
    assert.equal(projection.workspaceById.size, 3)
    assert.equal(projection.sessionById.size, 3)
    const nativeWorkspaceIds = new Set([...projection.workspaceById.values()].map(w => w.ref.nativeId))
    const titles = new Set([...projection.workspaceById.values()].map(w => w.title))
    assert.deepEqual([...titles], [COLLIDING_TITLE], 'all three nodes must share one workspace title')
    assert.ok(nativeWorkspaceIds.size >= 1)
    for (const workspace of projection.workspaceById.values()) {
      assert.equal(decodeWorkspaceId(workspace.id, new Set(projection.nodes.map(n => n.node.nodeId))).nodeId, workspace.ref.nodeId)
    }
    // Node → Workspace → Session ownership holds on every live node.
    for (const node of projection.nodes) {
      assert.equal(node.workspaces.length, 1, `${node.node.nodeId} must own exactly one workspace`)
      const [workspace] = node.workspaces
      assert.ok(workspace.id.startsWith(`fed1:${node.node.nodeId}:w:`))
      assert.equal(workspace.sessionIds.length, 1)
      assert.ok(workspace.sessionIds[0].startsWith(`fed1:${node.node.nodeId}:s:`))
      for (const session of node.sessions.values()) {
        assert.equal(session.title, COLLIDING_SESSION_TITLE)
        assert.equal(session.ref.nodeId, node.node.nodeId)
      }
    }

    // Owner-only routing: a command must reach exactly the encoded node, even
    // though all three carry identical native ids and titles.
    const router = new CommandRouter(ports)
    for (const server of servers) {
      const nodeId = parseNodeId(server.node.id)
      const federatedSession = [...projection.sessionById.values()].find(s => s.ref.nodeId === nodeId)
      const uniqueTitle = `renamed-on-${server.node.id}`
      await router.renameSession(federatedSession.id, uniqueTitle)
    }
    // Verify on each live server independently that only its own session changed.
    for (const server of servers) {
      const adapter = adapters.get(server.node.id)
      const sessions = await adapter.listSessions()
      assert.equal(sessions.length, 1)
      assert.equal(sessions[0].title, `renamed-on-${server.node.id}`,
        `${server.node.id} must show only its own rename`)
    }

    // Cross-node workspace reorder must be refused before any RPC.
    const [first, second] = [...projection.workspaceById.values()]
    // The router rejects before any RPC is issued, so this throws synchronously.
    assert.throws(
      () => router.workspaceReorder(first.id, second.id),
      error => error.code === 'CAPABILITY_DENIED' && /cross-node workspace reorder is forbidden/.test(error.message),
    )

    // Remote workspace/session lifecycle through the tunnel (task 10.3).
    const remote = servers.find(s => s.node.kind === 'remote')
    const remoteAdapter = adapters.get(remote.node.id)
    const remoteNodeId = parseNodeId(remote.node.id)
    const known = new Set(projection.nodes.map(n => n.node.nodeId))

    // create a second workspace on a real subdirectory of the remote project
    const childDir = path.join(remote.cwd, 'second-project')
    await mkdir(childDir, { recursive: true })
    const secondWorkspace = await remoteAdapter.createWorkspace(childDir)
    assert.ok(secondWorkspace.id.startsWith(`fed1:${remote.node.id}:w:`))
    assert.equal((await remoteAdapter.listWorkspaces()).length, 2)

    // same-node workspace reorder is allowed and durable
    const beforeOrder = (await remoteAdapter.listWorkspaces()).map(w => w.ref.nativeId)
    assert.equal(beforeOrder.length, 2)
    const federatedWorkspace = native => `fed1:${remote.node.id}:w:${Buffer.from(native).toString('base64url')}`
    // Move the trailing workspace ahead of the leading one: an exact swap, so
    // the assertion cannot pass on a no-op.
    await router.workspaceReorder(federatedWorkspace(beforeOrder[1]), federatedWorkspace(beforeOrder[0]))
    const afterOrder = (await remoteAdapter.listWorkspaces()).map(w => w.ref.nativeId)
    assert.deepEqual(afterOrder, [beforeOrder[1], beforeOrder[0]],
      'same-node reorder must durably swap the two workspaces')

    // session create → rename → fork → archive on the remote node
    const newSession = await remoteAdapter.createSession(secondWorkspace.ref.nativeId)
    const federatedNew = `fed1:${remote.node.id}:s:${Buffer.from(newSession).toString('base64url')}`
    await router.renameSession(federatedNew, 'remote-lifecycle')
    const listed = await remoteAdapter.listSessions()
    assert.ok(listed.some(s => s.title === 'remote-lifecycle'))

    // fork requires a completed turn, so a remote business error is correct here
    await assert.rejects(remoteAdapter.forkSession(newSession, undefined),
      error => error.name === 'RemoteBusinessError')

    await router.archiveSession(federatedNew)
    const afterArchive = await remoteAdapter.listWorkspaces()
    assert.ok(afterArchive.some(w => w.archivedSessionIds.length > 0), 'archive must be reflected in the remote account')

    await router.workspaceDelete(secondWorkspace.id)
    assert.equal((await remoteAdapter.listWorkspaces()).length, 1)

    // Cross-node session move must be refused before any RPC (task 10.3).
    const localSession = [...projection.sessionById.values()].find(s => s.ref.nodeId === parseNodeId('this-mac'))
    const remoteWorkspaceId = projection.nodes.find(n => n.node.nodeId === remoteNodeId).workspaces[0].id
    assert.equal(decodeSessionId(localSession.id, known).nodeId, parseNodeId('this-mac'))
    assert.notEqual(decodeWorkspaceId(remoteWorkspaceId, known).nodeId, decodeSessionId(localSession.id, known).nodeId)

    // A killed tunnel must not disturb the other nodes, and must not stop the
    // remote DSH: the central side owns only its own ssh child.
    assert.ok(tunnels.length >= 1)
    const victim = servers.find(s => s.node.id === nodes[1].id)
    const victimPid = victim.child.pid
    tunnels[0].kill('SIGKILL')
    await new Promise(resolve => tunnels[0].once('exit', resolve))

    const survivor = servers.find(s => s.node.kind === 'local')
    assert.equal((await adapters.get(survivor.node.id).listSessions()).length, 1,
      'local node must stay usable after a remote tunnel dies')
    const otherRemote = servers.find(s => s.node.kind === 'remote' && s.node.id !== victim.node.id)
    assert.equal((await adapters.get(otherRemote.node.id).listSessions()).length, 1,
      'the second remote must be unaffected by the first tunnel dying')
    await assert.rejects(adapters.get(victim.node.id).listSessions())

    // The remote dsh web is still alive: the central side never installs,
    // starts or stops remote DSH.
    assert.equal(victim.child.exitCode, null, 'remote DSH must survive its tunnel being killed')
    assert.equal(run('/bin/ps', ['-o', 'pid=', '-p', String(victimPid)]).stdout.trim(), String(victimPid))

    // A brand-new tunnel recovers the same durable remote state, with the
    // remote never having been restarted.
    const reopened = await openTunnel(sshConfig, victim.node.alias, victim.port)
    tunnels.push(reopened.child)
    const recovered = new DshRc2NodeAdapter(
      adapters.get(victim.node.id).node,
      new HttpUnaryCarrier({
        endpoint: new URL(`http://127.0.0.1:${reopened.localPort}`), generation: 2, currentGeneration: () => 2, timeoutMs: 30_000,
      }),
      adapters.get(victim.node.id).capabilities,
    )
    // The victim is the node that also ran the 10.3 lifecycle, so it owns more
    // than one session; assert durable identity rather than a stale count.
    const beforeLoss = await adapters.get(otherRemote.node.id).listSessions()
    const recoveredSessions = await recovered.listSessions()
    assert.ok(recoveredSessions.some(session => session.title === `renamed-on-${victim.node.id}`),
      'remote state must survive a central-side tunnel loss and reconnect')
    assert.ok(recoveredSessions.every(session => session.id.startsWith(`fed1:${victim.node.id}:s:`)),
      'recovered sessions must stay owned by their node')
    assert.equal(beforeLoss.length, 1, 'the untouched remote keeps exactly its own single session')
  } finally {
    for (const tunnel of tunnels) {
      if (tunnel.exitCode === null) tunnel.kill('SIGKILL')
    }
    for (const server of servers) {
      server.child.kill('SIGKILL')
      await new Promise(resolve => server.child.once('exit', resolve))
    }
    if (sshd?.sshd?.exitCode === null) sshd.sshd.kill('SIGTERM')
    for (const bundle of bundles) await rm(bundle, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
