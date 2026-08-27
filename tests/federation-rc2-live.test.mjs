import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openRealRc2Streams } from './helpers/rc2-stream-proof.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

/**
 * Conformance run of the real rc.2 adapter against a real `dsh web`.
 *
 * This is the only test that proves the adapter against the actual server
 * rather than fixtures transcribed from the pinned `.d.ts` files. It uses an
 * isolated DSH_HOME and cwd, never touches `~/.dsh`, and never drives
 * `session.prompt` (which would consume a model subscription).
 */

function dshBin() {
  const candidate = path.join(process.env.HOME ?? '', '.npm/_npx/de4831d60afe10da/node_modules/.bin/dsh')
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
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

async function apiReady(port, child) {
  // rc.2 composes /api after the TCP port opens, so readiness must be proven by
  // a real host.describe rather than by a successful connect.
  for (let attempt = 0; attempt < 240; attempt++) {
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

async function loadFederation() {
  const bundle = path.join(REPO, 'node_modules/.cache', `federation-live-${process.pid}.mjs`)
  const built = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(PKG, 'src/host/index.ts'), '--bundle', '--format=esm', '--platform=node',
    `--outfile=${bundle}`, '--log-level=error',
  ], { encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  return { module: await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`), bundle }
}

test('rc.2 adapter conforms to a real dsh web under an isolated DSH_HOME', { timeout: 300_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const home = await mkdtemp(path.join(tmpdir(), 'federation-live-home-'))
  const cwd = await mkdtemp(path.join(tmpdir(), 'federation-live-cwd-'))
  const port = await freePort()
  const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
    cwd, stdio: 'ignore',
    env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },
  })
  let bundle
  let streams
  try {
    await apiReady(port, child)
    const loaded = await loadFederation()
    bundle = loaded.bundle
    const { HttpUnaryCarrier, DshRc2NodeAdapter, RC2_ALLOWED_METHODS, RC2_FORBIDDEN_METHODS, RemoteBusinessError } = loaded.module

    const carrier = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 1, currentGeneration: () => 1, timeoutMs: 30_000,
    })

    // Structural probe must reach SUPPORTED even though rc.2 reports "0.0.1".
    streams = await openRealRc2Streams(loaded.module, new URL(`http://127.0.0.1:${port}`))
    const probe = await DshRc2NodeAdapter.probe(carrier, streams.proof)
    assert.equal(probe.compatibility, 'SUPPORTED', `probe diagnostic: ${probe.diagnostic}`)
    assert.ok(probe.capabilities.has('session.write'), 'writes must be granted to a structurally verified rc.2 node')

    const node = {
      nodeId: 'rc2-live', kind: 'remote', displayName: 'rc2 live', enabled: true, order: 1,
      capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
      sshAlias: 'fixture', remoteDshPort: port,
    }
    const adapter = new DshRc2NodeAdapter(node, carrier, probe.capabilities)

    assert.deepEqual(await adapter.listWorkspaces(), [])
    assert.deepEqual(await adapter.listSessions(), [])

    const workspace = await adapter.createWorkspace(cwd)
    assert.ok(workspace.id.startsWith('fed1:rc2-live:w:'), 'workspace id must carry its owning node')
    // rc.2 returns the host realpath, which may differ from the requested string.
    assert.ok(workspace.path.endsWith(path.basename(cwd)))

    const renamed = await adapter.renameWorkspace(workspace.ref.nativeId, 'Renamed WS')
    assert.equal(renamed.title, 'Renamed WS')

    const sessionId = await adapter.createSession(workspace.ref.nativeId)
    assert.ok(typeof sessionId === 'string' && sessionId.length > 0)

    const sessions = await adapter.listSessions()
    assert.equal(sessions.length, 1)
    assert.ok(sessions.every(session => session.id.startsWith('fed1:rc2-live:s:')))

    const workspaces = await adapter.listWorkspaces()
    assert.equal(workspaces.length, 1)
    assert.equal(workspaces[0].sessionIds.length, 1)

    assert.equal(typeof await adapter.history(sessionId), 'object')
    assert.equal(typeof await adapter.models(sessionId), 'object')

    const titled = await adapter.renameSession(sessionId, 'Live renamed')
    assert.equal(titled.title, 'Live renamed')
    assert.ok(Number.isFinite(titled.seq))

    // Optional, state-dependent capability: never fail the federated search.
    assert.deepEqual(await adapter.search({ query: 'Live', limit: 10 }), [])
    assert.deepEqual(await adapter.search({ query: 'Live', limit: 10 }), [])

    await adapter.cancel(sessionId)
    await adapter.archiveSession(sessionId)
    await adapter.deleteWorkspace(workspace.ref.nativeId)

    // Remote business errors stay distinct from transport/protocol faults.
    await assert.rejects(
      adapter.updateQueue(sessionId, { itemId: 'missing-item', action: { kind: 'remove' } }),
      error => error instanceof RemoteBusinessError,
    )

    for (const method of RC2_FORBIDDEN_METHODS) {
      assert.equal(RC2_ALLOWED_METHODS.has(method), false, `${method} must stay unreachable`)
    }
  } finally {
    streams?.dispose()
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    if (bundle) await rm(bundle, { force: true })
    await rm(home, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
  }
})
