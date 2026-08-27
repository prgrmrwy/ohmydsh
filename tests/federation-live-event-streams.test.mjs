import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Live dual event-stream proof against a real `dsh web`.
 *
 * Until now `DualEventCarrier` had only ever run against hand-written fake
 * sockets, so the transport choice itself was unverified. This test pins the
 * real behaviour:
 *
 * - a real rc.2 server answers `GET /api/events.{mux,host}` with **HTTP 426
 *   upgrade required**, i.e. SSE is not served on the browser carrier path;
 * - both streams open over a real WebSocket upgrade;
 * - the real carrier receives real frames, and the real adapter converts them
 *   into stable Core frames with federated identities;
 * - a generation change makes late frames from the old generation dropped.
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

async function call(port, method, payload) {
  const response = await fetch(`http://127.0.0.1:${port}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `live-${method}`, method, payload }),
  })
  return response.json()
}

async function apiReady(port, child) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) throw new Error(`dsh web exited early: ${child.exitCode}`)
    try {
      const parsed = await call(port, 'host.describe', {})
      if (parsed?.result?.ok === true) return
    } catch {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('rc.2 /api never became ready')
}

test('the dual event carrier consumes real rc.2 WebSocket streams', { timeout: 300_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-streams-'))
  const home = path.join(root, 'home')
  const cwd = path.join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(cwd, { recursive: true })
  const port = await freePort()
  const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
    cwd, stdio: 'ignore',
    env: { ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1' },
  })
  let bundle
  let carrier
  try {
    await apiReady(port, child)

    // 1) Pin the transport: the browser carrier path is WebSocket-only.
    for (const stream of ['events.mux', 'events.host']) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/${stream}`, { signal: controller.signal })
        assert.equal(response.status, 426, `${stream} must demand a WebSocket upgrade, got HTTP ${response.status}`)
        await response.text()
      } finally {
        clearTimeout(timer)
      }
    }

    bundle = path.join(REPO, 'node_modules/.cache', `federation-streams-${process.pid}.mjs`)
    const built = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
      path.join(PKG, 'src/host/index.ts'), '--bundle', '--format=esm', '--platform=node',
      `--outfile=${bundle}`, '--log-level=error',
    ])
    assert.equal(built.status, 0, built.stderr)
    const { DualEventCarrier, HttpUnaryCarrier, DshRc2NodeAdapter, validateRc2EventEnvelope } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)

    // 2) Open both real streams through the real carrier. Node's global
    //    WebSocket already satisfies the CarrierSocket shape.
    let generation = 1
    const frames = []
    const disconnects = []
    carrier = new DualEventCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`),
      generation: 1,
      currentGeneration: () => generation,
      createSocket: url => new WebSocket(url),
      validate: validateRc2EventEnvelope,
      onFrame: frame => { frames.push(frame) },
      onDisconnect: event => { disconnects.push(event) },
    })
    const streamProof = await carrier.open()

    // 3) Cause real host activity and wait for real frames to arrive.
    const unary = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 1, currentGeneration: () => generation, timeoutMs: 30_000,
    })
    const probe = await DshRc2NodeAdapter.probe(unary, streamProof)
    const adapter = new DshRc2NodeAdapter({
      nodeId: 'vm-streams', kind: 'remote', displayName: 'vm-streams', enabled: true, order: 1,
      capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
      sshAlias: 'fixture', remoteDshPort: port,
    }, unary, probe.capabilities)

    const workspace = await adapter.createWorkspace(cwd)
    const sessionId = await adapter.createSession(workspace.ref.nativeId)
    await adapter.renameSession(sessionId, 'stream-probe')

    for (let attempt = 0; attempt < 80 && frames.length === 0; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 125))
    }
    assert.ok(frames.length > 0, 'expected at least one real frame from the live streams')

    // Frames must arrive tagged with their stream and this generation.
    assert.ok(frames.every(frame => frame.generation === 1), JSON.stringify(frames.slice(0, 2)))
    assert.ok(frames.every(frame => frame.stream === 'mux' || frame.stream === 'host'))

    // 4) The adapter must convert at least one real frame into a stable Core
    //    frame with a federated identity — no rc.2 schema leaking outward.
    let converted = 0
    for (const frame of frames) {
      const event = adapter.convertFrame(frame.stream, frame.value)
      if (event.kind === 'reconciliation') {
        converted++
        const { frame: core } = event
        if (core.domain === 'session' || core.domain === 'status' || core.domain === 'status-remove') {
          assert.equal(typeof core.sessionId, 'string')
        }
        if (core.domain === 'workspace-upsert' || core.domain === 'workspace-remove') {
          assert.equal(typeof core.workspaceId, 'string')
        }
      }
    }
    assert.ok(converted > 0, `no live frame converted to a Core frame: ${JSON.stringify(frames.slice(0, 3))}`)

    // Both real streams must have delivered, and the observed frame vocabulary
    // must include the session and host families the projection depends on.
    const streams = new Set(frames.map(frame => frame.stream))
    assert.deepEqual([...streams].sort(), ['host', 'mux'], 'both live streams must deliver frames')
    const types = new Set(frames.map(frame => frame.value?.payload?.type).filter(Boolean))
    for (const expected of ['session/subscribed', 'session/event', 'session/projection', 'host/workspace-changed', 'host/session-added']) {
      assert.ok(types.has(expected), `expected a live ${expected} frame; saw ${[...types].join(', ')}`)
    }

    // 5) Old-generation frames are dropped once the generation moves on.
    // Baseline: prove this action DOES generate frames while the generation is
    // current, so the drop assertion below cannot pass vacuously.
    const beforeControl = frames.length
    await adapter.renameSession(sessionId, 'still-current-generation')
    for (let attempt = 0; attempt < 80 && frames.length === beforeControl; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 125))
    }
    assert.ok(frames.length > beforeControl,
      'a rename must produce live frames while the generation is current')

    const seenBefore = frames.length
    generation = 2
    // The write must SUCCEED so the server really emits frames; only the event
    // carrier is stale. Using the old unary carrier here would fail with
    // StaleGeneration and make the assertion vacuous.
    const currentUnary = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 2, currentGeneration: () => generation, timeoutMs: 30_000,
    })
    const currentAdapter = new DshRc2NodeAdapter(adapter.node, currentUnary, probe.capabilities)
    const renamed = await currentAdapter.renameSession(sessionId, 'after-generation-change')
    assert.equal(renamed.title, 'after-generation-change', 'the write itself must succeed')

    await new Promise(resolve => setTimeout(resolve, 1500))
    assert.equal(frames.length, seenBefore,
      'frames from the superseded generation must be dropped, not delivered')
  } finally {
    carrier?.dispose()
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    if (bundle) await rm(bundle, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})
