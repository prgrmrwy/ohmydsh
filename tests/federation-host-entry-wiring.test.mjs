import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * The plugin entry must actually wire federation into DSH.
 *
 * Every M2 mechanism was individually proven, but `apply()` was an empty stub,
 * so enabling the package would have rendered and routed nothing. This test
 * drives the real `apply()` through the patched Connection over a real HTTP
 * server, and pins the conservative activation rule:
 *
 *   - no registry / unreadable registry / no enabled remote → Host untouched;
 *   - a registry with an enabled remote → federation claims the sole `/api`
 *     outer middleware and rejects forged ids before the native chain.
 *
 * Nothing touches `~/.dsh`; no deployment runs.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

const run = (command, args) => spawnSync(command, args, { encoding: 'utf8' })

async function buildFederation(root) {
  const entry = path.join(root, 'entry.ts')
  await writeFile(entry, `export * from ${JSON.stringify(path.join(PKG, 'src/index.ts'))}\n`)
  const bundle = path.join(root, 'federation.mjs')
  const built = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--format=esm', '--platform=node', '--packages=external',
    `--outfile=${bundle}`, '--log-level=error',
  ])
  assert.equal(built.status, 0, built.stderr)
  await symlink(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  return import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
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
  const bundle = path.join(root, 'connection.mjs')
  assert.equal(run(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(root, 'connection/src/index.ts'), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${bundle}`,
  ]).status, 0)
  return import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
}

/** Writes a registry with the requested number of enabled remotes. */
async function seedRegistry(fed, home, remotes) {
  const storage = new fed.NodeRegistryStorage(home)
  let snapshot = fed.NodeRegistryModel.create(fed.parseNodeId('this-mac')).snapshot
  await storage.save(snapshot, 'missing')
  for (let index = 0; index < remotes; index++) {
    const label = `vm-${index}`
    const model = new fed.NodeRegistryModel(snapshot)
    const next = model.addRemote({
      nodeId: fed.parseNodeId(label), displayName: label, sshAlias: label, remoteDshPort: 3080,
    })
    snapshot = await storage.save(next, snapshot.generation)
  }
  return snapshot
}

async function serve(connectionModule, fed, home, expectFederationClaim, signalSource, sshExecutable) {
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

  // In production the middleware's `next` IS the composed native chain, so the
  // native side must be the fallback rather than a competing middleware.
  const nativeCalls = []
  const nativeChain = {
    fetch: async request => {
      nativeCalls.push(new URL(request.url).pathname)
      return Response.json({ routed: 'native' })
    },
  }
  const connection = ctx.get('connection')
  const originalUse = connection.api.use.bind(connection.api)
  let federationClaimed = false
  // Federation claims the single seam; wrap so its `next` reaches our stand-in.
  Object.defineProperty(connection, 'api', {
    configurable: true,
    get: () => ({
      use: middleware => {
        federationClaimed = true
        return originalUse(async (request, _next) => middleware(request, nativeChain))
      },
    }),
  })

  const fiber = ctx.inject(['connection'], child => {
    fed.apply(child, {
      dshHome: home,
      ...(signalSource === undefined ? {} : { signalSource }),
      ...(sshExecutable === undefined ? {} : { sshExecutable }),
    })
  })
  // apply() reads the registry asynchronously. Poll for the decision instead of
  // sleeping a fixed interval, which is flaky under parallel test load.
  const expectClaim = expectFederationClaim
  for (let attempt = 0; attempt < 200 && federationClaimed !== expectClaim; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(federationClaimed, expectClaim,
    expectClaim ? 'federation must claim the /api seam' : 'federation must not claim the /api seam')

  // When federation declines, the native chain must still answer, exactly as
  // the untouched composed handler would.
  if (!federationClaimed) originalUse(async request => nativeChain.fetch(request))

  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    nativeCalls,
    get federationClaimed() { return federationClaimed },
    async post(pathname, payload) {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      })
      return { status: response.status, body: await response.json().catch(() => ({})) }
    },
    async postRpc(method, payload, rpcId = `browser-${method}`) {
      return this.post(`/api/${method}`, {
        type: 'client-request', rpcId, method, payload,
      })
    },
    async close() {
      await new Promise(resolve => server.close(resolve))
      await fiber.dispose?.()
    },
  }
}

test('apply() leaves the Host untouched when no registry declares an enabled remote', { timeout: 400_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-wiring-none-'))
  let served
  try {
    const fed = await buildFederation(root)
    const connectionModule = await buildConnection(root)

    // Case A: no registry at all.
    const emptyHome = path.join(root, 'home-empty')
    await mkdir(emptyHome, { recursive: true })
    served = await serve(connectionModule, fed, emptyHome, false)
    const forged = await served.post('/api/session.rename', { sessionId: 'fed1:vm-0:s:c2Vzc2lvbg', title: 'x' })
    assert.equal(served.federationClaimed, false,
      'with no registry, federation must not claim the /api seam at all')
    assert.equal(forged.body.routed, 'native')
    assert.deepEqual(served.nativeCalls, ['/api/session.rename'])
    await served.close()
    served = undefined

    // Case B: a registry that exists but declares no enabled remote.
    const localOnly = path.join(root, 'home-local-only')
    await mkdir(localOnly, { recursive: true })
    await seedRegistry(fed, localOnly, 0)
    served = await serve(connectionModule, fed, localOnly, false)
    const stillNative = await served.post('/api/session.rename', { sessionId: 'fed1:vm-0:s:c2Vzc2lvbg', title: 'x' })
    assert.equal(served.federationClaimed, false,
      'a local-only registry must not activate federation')
    assert.equal(stillNative.body.routed, 'native')
  } finally {
    await served?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('apply() claims the sole /api seam and rejects forged ids once a remote is registered', { timeout: 400_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-wiring-active-'))
  let served
  try {
    const fed = await buildFederation(root)
    const connectionModule = await buildConnection(root)
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    await seedRegistry(fed, home, 1)

    served = await serve(connectionModule, fed, home, true)

    // A federated id for an UNKNOWN node must be rejected by federation, never
    // handed to the native chain.
    const forged = await served.postRpc('session.rename', { sessionId: 'fed1:ghost:s:c2Vzc2lvbg', title: 'x' }, 'forged-rpc')
    assert.equal(forged.status, 400, JSON.stringify(forged))
    assert.equal(forged.body?.result?.error?.code ?? forged.body?.error?.code, 'federation-id-unknown-node', JSON.stringify(forged.body))
    assert.deepEqual(served.nativeCalls, [], 'a forged id must not reach the native chain')

    // A bare native id still reaches the untouched native chain.
    const native = await served.postRpc('session.rename', { sessionId: 'plain-native', title: 'ok' }, 'native-rpc')
    assert.equal(native.body.routed, 'native', JSON.stringify(native.body))
    assert.deepEqual(served.nativeCalls, ['/api/session.rename'])

    // A known-node id with no connected port fails closed rather than being
    // silently interpreted locally.
    const unconnected = await served.postRpc('session.cancel', {
      sessionId: fed.encodeSessionId({ nodeId: fed.parseNodeId('vm-0'), nativeId: 'shared' }),
    }, 'unconnected-rpc')
    assert.equal(unconnected.body?.result?.error?.code ?? unconnected.body?.error?.code, 'federation-unknown-node', JSON.stringify(unconnected.body))
    assert.deepEqual(served.nativeCalls, ['/api/session.rename'],
      'an unconnected known node must not fall through to This Mac')
  } finally {
    await served?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('apply() serves node management backed by the real registry and identity gate', { timeout: 400_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-wiring-manage-'))
  let served
  try {
    const fed = await buildFederation(root)
    const connectionModule = await buildConnection(root)
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    await seedRegistry(fed, home, 1)

    // A fake ssh stands in for system OpenSSH. The real identity rule is "a
    // BatchMode session that stays up past the stability window", so the stub
    // must persist for an identity probe (`SessionType=none`) while refusing
    // port forwarding (`-L`), which keeps tunnels failing fast instead of
    // blocking this test on a fake listener.
    const sshStub = path.join(root, 'ssh-accept')
    await writeFile(sshStub, [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  if [ "$arg" = "-L" ]; then echo "forwarding refused by fixture" 1>&2; exit 255; fi',
      'done',
      'sleep 5',
    ].join('\n'), { mode: 0o755 })
    served = await serve(connectionModule, fed, home, true, undefined, sshStub)

    const added = await served.postRpc('federation/node.add', {
      displayName: 'Managed VM', sshAlias: 'managed-vm', remoteDshPort: 3080,
    }, 'browser-manage-1')
    assert.equal(added.status, 200, JSON.stringify(added.body))
    assert.equal(added.body.rpcId, 'browser-manage-1')
    const createdId = added.body?.result?.value?.nodeId
    assert.ok(typeof createdId === 'string' && createdId.length > 0, JSON.stringify(added.body))

    // The write must be visible through the same inventory the browser reads.
    const nodes = await served.postRpc('federation/nodes', {}, 'browser-manage-2')
    const managed = (nodes.body?.result?.value?.nodes ?? []).find(node => node.nodeId === createdId)
    assert.ok(managed, JSON.stringify(nodes.body))
    assert.equal(managed.displayName, 'Managed VM')

    // Disabling is a registry write, not a live-state guess.
    const updated = await served.postRpc('federation/node.update', { nodeId: createdId, enabled: false }, 'browser-manage-3')
    assert.equal(updated.status, 200, JSON.stringify(updated.body))
    const afterUpdate = await served.postRpc('federation/nodes', {}, 'browser-manage-4')
    assert.equal((afterUpdate.body?.result?.value?.nodes ?? []).find(node => node.nodeId === createdId)?.enabled, false)

    // Removing a node with no unknown writes needs no confirmation.
    const removed = await served.postRpc('federation/node.remove', { nodeId: createdId }, 'browser-manage-5')
    assert.equal(removed.status, 200, JSON.stringify(removed.body))
    const afterRemove = await served.postRpc('federation/nodes', {}, 'browser-manage-6')
    assert.equal((afterRemove.body?.result?.value?.nodes ?? []).some(node => node.nodeId === createdId), false)

    // An identity that cannot authenticate non-interactively must not persist.
    const sshDeny = path.join(root, 'ssh-deny')
    await writeFile(sshDeny, '#!/bin/sh\necho "Permission denied (publickey)." 1>&2\nexit 255\n', { mode: 0o755 })
    await served.close()
    served = await serve(connectionModule, fed, home, true, undefined, sshDeny)
    const refused = await served.postRpc('federation/node.add', {
      displayName: 'Unverified', sshAlias: 'unverified-vm', remoteDshPort: 3080,
    }, 'browser-manage-7')
    assert.notEqual(refused.status, 200, JSON.stringify(refused.body))
    const finalNodes = await served.postRpc('federation/nodes', {}, 'browser-manage-8')
    assert.equal((finalNodes.body?.result?.value?.nodes ?? []).some(node => node.displayName === 'Unverified'), false)
    assert.equal(served.nativeCalls.length, 0, 'node management must never reach the native chain')
  } finally {
    await served?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('apply() releases its own SSH children on catchable termination and unbinds on dispose', { timeout: 400_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-wiring-signals-'))
  let served
  try {
    const fed = await buildFederation(root)
    const connectionModule = await buildConnection(root)
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    await seedRegistry(fed, home, 1)

    const listeners = new Map()
    const signalSource = {
      on(signal, listener) {
        const list = listeners.get(signal) ?? []
        list.push(listener)
        listeners.set(signal, list)
      },
      off(signal, listener) {
        listeners.set(signal, (listeners.get(signal) ?? []).filter(entry => entry !== listener))
      },
    }
    served = await serve(connectionModule, fed, home, true, signalSource)

    // Federation must register catchable-shutdown cleanup for the SSH children
    // it owns, and must never rely on an uncatchable kill.
    for (let attempt = 0; attempt < 200 && (listeners.get('SIGTERM') ?? []).length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal((listeners.get('SIGTERM') ?? []).length, 1, 'SIGTERM cleanup must be bound')
    assert.equal((listeners.get('SIGINT') ?? []).length, 1, 'SIGINT cleanup must be bound')

    // A real signal must dispose the owned tunnels exactly once.
    for (const listener of listeners.get('SIGTERM') ?? []) listener()
    for (const listener of listeners.get('SIGTERM') ?? []) listener()

    await served.close()
    served = undefined
    assert.deepEqual((listeners.get('SIGTERM') ?? []).length, 0, 'dispose must unbind SIGTERM')
    assert.deepEqual((listeners.get('SIGINT') ?? []).length, 0, 'dispose must unbind SIGINT')
  } finally {
    await served?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('the Host serves the federation inventory endpoints the browser depends on', { timeout: 400_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'federation-inventory-'))
  let served
  try {
    const fed = await buildFederation(root)
    const connectionModule = await buildConnection(root)
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    await seedRegistry(fed, home, 1)

    served = await serve(connectionModule, fed, home, true)

    // 1) federation/nodes must be answered BY FEDERATION, never by the native
    //    chain, and must include both the local node and the registered remote.
    // The client's generic RPC channel rejects a reply whose rpcId does not
    // match the request, so every federation reply MUST echo it.
    const nodes = await served.postRpc('federation/nodes', {}, 'browser-rpc-1')
    assert.equal(nodes.status, 200, JSON.stringify(nodes))
    assert.equal(nodes.body.rpcId, 'browser-rpc-1',
      `the reply must echo the request rpcId: ${JSON.stringify(nodes.body)}`)
    assert.equal(nodes.body.type, 'server-response')
    assert.notEqual(nodes.body.routed, 'native',
      'federation/nodes must never reach the native chain')
    const list = nodes.body?.result?.value?.nodes ?? nodes.body?.nodes
    assert.ok(Array.isArray(list), `unexpected inventory shape: ${JSON.stringify(nodes.body)}`)
    assert.deepEqual(list.map(node => node.kind).sort(), ['local', 'remote'])
    // Liveness must come from the real connection attempt, never be reported
    // optimistically as READY/SUPPORTED. This fixture's alias is deliberately
    // nonexistent, so the node stays unreachable and only alternates between its
    // failure classification and the owned reconnect backoff.
    const remote = list.find(node => node.kind === 'remote')
    assert.ok(['SSH_UNREACHABLE', 'CONNECTING'].includes(remote.state), JSON.stringify(remote))
    assert.equal(remote.compatibility, 'INCOMPATIBLE')
    assert.equal(typeof remote.diagnostic, 'string')
    assert.equal(served.nativeCalls.length, 0)

    // 2) A baseline for an UNKNOWN node must be rejected as an identity error.
    const forged = await served.postRpc('federation/baseline', { nodeId: 'ghost' }, 'browser-rpc-2')
    assert.equal(forged.body.rpcId, 'browser-rpc-2', 'error replies must echo rpcId too')
    assert.equal(forged.body?.result?.error?.code ?? forged.body?.error?.code, 'federation-id-unknown-node', JSON.stringify(forged.body))

    // 3) A baseline for a registered-but-unconnected node must fail closed, not
    //    silently return an empty tree that would look like a real baseline.
    const unconnected = await served.postRpc('federation/baseline', { nodeId: 'vm-0' }, 'browser-rpc-3')
    assert.notEqual(unconnected.status, 200,
      `an unconnected node must not yield a baseline: ${JSON.stringify(unconnected.body)}`)
    assert.equal(served.nativeCalls.length, 0,
      'inventory requests must never fall through to This Mac')
  } finally {
    await served?.close()
    await rm(root, { recursive: true, force: true })
  }
})
