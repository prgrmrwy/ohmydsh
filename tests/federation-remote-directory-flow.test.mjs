import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Remote in-app directory flow against a real `dsh web` that serves the
 * **browse** picker.
 *
 * rc.2's `directory-picker-auto` resolves to `browse` whenever the host looks
 * SSH-reached (`SSH_CONNECTION` / `SSH_TTY` present) — which is exactly what a
 * federated remote node is. That makes this the realistic remote-node shape,
 * as opposed to the local macOS default (`native`), where `host.listDirectory`
 * is deliberately not served.
 *
 * Nothing touches `~/.dsh`; no deployment runs.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG = path.join(REPO, 'packages/dsh-federation')

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

test('a browse-serving remote node drives the node-bound directory flow', { timeout: 300_000 }, async t => {
  const dsh = dshBin()
  if (dsh === undefined) {
    t.skip('pinned rc.2 dsh binary is not present in the npx cache')
    return
  }

  const root = await mkdtemp(path.join(tmpdir(), 'federation-browse-'))
  const home = path.join(root, 'home')
  const cwd = path.join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(path.join(cwd, 'visible-child'), { recursive: true })
  await mkdir(path.join(cwd, '.hidden-child'), { recursive: true })
  const port = await freePort()
  // Presenting as an SSH-reached host is what makes rc.2 compose `browse`.
  const child = spawn(dsh, ['web', '--port', String(port), '--no-open'], {
    cwd, stdio: 'ignore',
    env: {
      ...process.env, DSH_HOME: home, DSH_SKIP_UPDATE: '1',
      SSH_CONNECTION: '127.0.0.1 54321 127.0.0.1 22', SSH_TTY: '/dev/ttys999',
    },
  })
  let bundle
  try {
    await apiReady(port, child)
    bundle = path.join(REPO, 'node_modules/.cache', `federation-browse-${process.pid}.mjs`)
    const built = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
      path.join(PKG, 'src/host/index.ts'), '--bundle', '--format=esm', '--platform=node',
      `--outfile=${bundle}`, '--log-level=error',
    ])
    assert.equal(built.status, 0, built.stderr)
    const clientBundle = bundle.replace('.mjs', '-client.mjs')
    const builtClient = run(path.join(REPO, 'node_modules/.bin/esbuild'), [
      path.join(PKG, 'src/client/shell/directory-flow.ts'), '--bundle', '--format=esm', '--platform=node',
      `--outfile=${clientBundle}`, '--log-level=error',
    ])
    assert.equal(builtClient.status, 0, builtClient.stderr)

    const { HttpUnaryCarrier, DshRc2NodeAdapter } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`)
    const { NodeDirectoryFlow } = await import(`${pathToFileURL(clientBundle).href}?v=${Date.now()}`)

    const carrier = new HttpUnaryCarrier({
      endpoint: new URL(`http://127.0.0.1:${port}`), generation: 1, currentGeneration: () => 1, timeoutMs: 30_000,
    })
    const probe = await DshRc2NodeAdapter.probe(carrier, { mux: true, host: true })
    assert.equal(probe.compatibility, 'SUPPORTED', probe.diagnostic)

    // This is the whole point: a browse-serving node grants directory capabilities.
    assert.ok(probe.capabilities.has('directory.read'), `expected browse capability; got: ${probe.diagnostic}`)
    assert.ok(probe.capabilities.has('directory.write'), probe.diagnostic)
    assert.match(probe.diagnostic, /directory browse available/)

    const nodeId = 'vm-browse'
    const adapter = new DshRc2NodeAdapter({
      nodeId, kind: 'remote', displayName: nodeId, enabled: true, order: 1,
      capabilities: probe.capabilities, compatibility: probe.compatibility, state: 'READY',
      sshAlias: 'fixture', remoteDshPort: port,
    }, carrier, probe.capabilities)

    // Every directory request is bound to its owning node id.
    const seen = []
    const flow = new NodeDirectoryFlow({
      nodeId, mode: 'browse',
      port: {
        listDirectory: async (node, target, signal) => {
          seen.push(['list', node, target])
          return adapter.listDirectory(target, signal === undefined ? undefined : { signal })
        },
        createDirectory: async (node, parent, name, signal) => {
          seen.push(['create', node, parent, name])
          return adapter.createDirectory(parent, name, signal === undefined ? undefined : { signal })
        },
      },
    })
    assert.equal(flow.usesNativeChooser, false, 'a remote node must use the in-app browse flow')

    // Miller-column listing of a real remote directory level.
    const level = await flow.open(cwd)
    assert.equal(level.kind, 'ready', JSON.stringify(level))
    // host.listDirectory echoes the listed path; only workspace.create canonicalizes.
    assert.ok(level.level.path.endsWith('/project'), level.level.path)
    assert.ok(level.level.crumbs.length > 0, 'breadcrumbs must come from the remote host')

    // Hidden directories are present in the payload but filtered by the flow.
    const names = () => flow.visibleEntries().map(entry => entry.name)
    assert.deepEqual(names(), ['visible-child'])
    flow.setShowHidden(true)
    assert.deepEqual(names().sort(), ['.hidden-child', 'visible-child'])

    // Single-level creation, then the flow navigates into the created child.
    const created = await flow.createChild('made-by-federation')
    assert.equal(created.kind, 'ready', JSON.stringify(created))
    assert.ok(created.level.path.endsWith('made-by-federation'))

    // A multi-segment name never reaches the remote.
    const before = seen.filter(([kind]) => kind === 'create').length
    const rejected = await flow.createChild('a/b')
    assert.equal(rejected.kind, 'error')
    assert.match(rejected.message, /single path segment/)
    assert.equal(seen.filter(([kind]) => kind === 'create').length, before)

    // Registering the browsed remote directory as a real workspace.
    const workspace = await adapter.createWorkspace(created.level.path)
    assert.ok(workspace.id.startsWith(`fed1:${nodeId}:w:`))

    // Every recorded request carried the owning node id explicitly.
    assert.ok(seen.length >= 3)
    assert.ok(seen.every(entry => entry[1] === nodeId), JSON.stringify(seen))
  } finally {
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    if (bundle) {
      await rm(bundle, { force: true })
      await rm(bundle.replace('.mjs', '-client.mjs'), { force: true })
    }
    await rm(root, { recursive: true, force: true })
  }
})
