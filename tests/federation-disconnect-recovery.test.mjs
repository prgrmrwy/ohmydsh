import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openRealRc2Streams } from './helpers/rc2-stream-proof.mjs'

/**
 * Central-disconnect independence and reconnect recovery (task 10.2, the half
 * that needs no model subscription).
 *
 * Proves against a real `dsh web` that:
 *
 * - a central-side generation change / carrier teardown never touches the
 *   remote Host process or its durable state;
 * - work committed on the remote while the central side is disconnected is
 *   present after reconnect;
 * - a reconnect installs a NEW generation, and late frames from the old
 *   generation are discarded rather than applied;
 * - writes issued while disconnected are never auto-replayed.
 *
 * Prompt/stream/tool/approval acceptance is deliberately excluded: it would
 * consume a real model subscription.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

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

test('a central disconnect leaves the remote independent and recovery is generation-safe', { timeout: 300_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-recovery-'))
  const home = path.join(root, 'home')
  const cwd = path.join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })
  const port = await freePort()
  const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
    cwd, stdio: 'ignore',
    env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },
  })
  const remotePid = child.pid
  let bundles = []
  let streams
  try {
    await apiReady(port, child)
    const hostBundle = path.join(REPO, 'node_modules/.cache', `federation-recovery-${process.pid}.mjs`)
    const coreBundle = hostBundle.replace('.mjs', '-core.mjs')
    bundles = [hostBundle, coreBundle]
    for (const [entry, out] of [['src/host/index.ts', hostBundle], ['src/core/index.ts', coreBundle]]) {
      const built = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
        path.join(PKG, entry), '--bundle', '--format=esm', '--platform=node', `--outfile=${out}`, '--log-level=error',
      ])
      assert.equal(built.status, 0, built.stderr)
    }
    const host = await import(`${pathToFileURL(hostBundle).href}?v=${Date.now()}`)
    const { HttpUnaryCarrier, DshRc2NodeAdapter } = host
    const { NodeReconciler, WriteLedger, parseNodeId } = await import(`${pathToFileURL(coreBundle).href}?v=${Date.now()}`)

    const nodeId = parseNodeId('vm-recover')
    // Generation 1: connected.
    let generation = 1
    const carrier1 = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 1, currentGeneration: () => generation, timeoutMs: 30_000,
    })
    streams = await openRealRc2Streams(host, new URL(`http://127.0.0.1:${port}`))
    const probe = await DshRc2NodeAdapter.probe(carrier1, streams.proof)
    const descriptor = {
      nodeId, kind: 'remote', displayName: 'vm-recover', enabled: true, order: 1,
      capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
      sshAlias: 'fixture', remoteDshPort: port,
    }
    const adapter1 = new DshRc2NodeAdapter(descriptor, carrier1, probe.capabilities)

    const workspace = await adapter1.createWorkspace(cwd)
    const sessionBefore = await adapter1.createSession(workspace.ref.nativeId)
    await adapter1.renameSession(sessionBefore, 'before-disconnect')

    const reconciler = new NodeReconciler(nodeId)
    const firstGeneration = reconciler.begin()
    reconciler.installBaseline(firstGeneration, { workspaces: [], statuses: [] }, [
      { id: sessionBefore, seq: 1, value: 'before-disconnect' },
    ])
    reconciler.markStreamsReady(firstGeneration)

    // --- central side "disconnects": its generation moves on. ---
    generation = 2
    await assert.rejects(adapter1.listSessions(), error => error.kind === 'StaleGeneration',
      'a stale-generation carrier must refuse to talk')

    // A write in flight at disconnect stays unknown and is never auto-replayed.
    const ledger = new WriteLedger()
    const inFlight = 'op-during-disconnect'
    ledger.create({ operationId: inFlight, nodeId, kind: 'cancel' })
    ledger.markSent(inFlight)
    ledger.markConnectionLost(inFlight)
    assert.equal(ledger.get(inFlight).state, 'OUTCOME_UNKNOWN')
    assert.deepEqual(ledger.replayable(), [], 'uncertain writes must never be queued for replay')

    // --- the remote keeps working entirely on its own. ---
    assert.equal(child.exitCode, null, 'remote DSH must be untouched by a central disconnect')
    assert.equal(run('/bin/ps', ['-o', 'pid=', '-p', String(remotePid)]).stdout.trim(), String(remotePid))

    // Commit real remote work while the central side is away, using a direct
    // client (i.e. as the remote's own browser/operator would).
    const directCall = async (method, payload) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `direct-${method}`, method, payload }),
      })
      const parsed = await response.json()
      assert.equal(parsed.result.ok, true, JSON.stringify(parsed.result))
      return parsed.result.value
    }
    const madeWhileAway = await directCall('session.create', { workspaceId: workspace.ref.nativeId })
    await directCall('session.rename', { sessionId: madeWhileAway.sessionId, title: 'made-while-central-was-away' })

    // --- reconnect on a NEW generation. ---
    const carrier2 = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 2, currentGeneration: () => generation, timeoutMs: 30_000,
    })
    const adapter2 = new DshRc2NodeAdapter(descriptor, carrier2, probe.capabilities)
    const recovered = await adapter2.listSessions()

    const titles = recovered.map(session => session.title)
    assert.ok(titles.includes('before-disconnect'), JSON.stringify(titles))
    assert.ok(titles.includes('made-while-central-was-away'),
      'work the remote committed while disconnected must appear after reconnect')
    assert.ok(recovered.every(session => session.id.startsWith(`fed1:${nodeId}:s:`)))

    // Old-generation frames must be discarded, not applied to the new baseline.
    const secondGeneration = reconciler.begin()
    assert.notEqual(secondGeneration, firstGeneration)
    assert.equal(
      reconciler.accept(firstGeneration, { domain: 'session', sessionId: sessionBefore, seq: 99, value: 'late-old-generation' }),
      false,
      'a late frame from the previous generation must be rejected',
    )
    reconciler.installBaseline(secondGeneration, { workspaces: [], statuses: [] },
      recovered.map((session, index) => ({ id: session.ref.nativeId, seq: index + 1, value: session.title })))
    reconciler.markStreamsReady(secondGeneration)
    const view = reconciler.view()
    assert.equal(view.generation, secondGeneration)
    assert.equal(view.ready, true)
    assert.equal([...view.sessionEvents.values()].some(entry => entry.value === 'late-old-generation'), false)

    // The uncertain write is still unknown after recovery: reconnecting proves
    // nothing about whether it executed.
    assert.equal(ledger.get(inFlight).state, 'OUTCOME_UNKNOWN')
    assert.deepEqual(ledger.replayable(), [])
  } finally {
    streams?.dispose()
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    for (const bundle of bundles) await rm(bundle, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
