import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Trust-fence ordering for the federation `/api` middleware seam.
 *
 * The existing Connection compat test drives `handleApiRequest` through a
 * hand-built service, which cannot show *where* the middleware sits relative to
 * the Host/Origin fence. That ordering is the security property: federation must
 * never observe an untrusted cross-site request, and must never be able to
 * bypass the fence.
 *
 * This test exercises the patched module's real `apply()` — its actual route
 * registration and real `isTrustedApiRequest` — with a fake web server.
 */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function buildPatchedConnection(root) {
  const fetched = spawnSync(process.execPath, [
    'scripts/fetch-rc2-connection-source.mjs',
    '--cache-dir', path.join(root, 'cache'),
    '--output-dir', path.join(root, 'source'),
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(fetched.status, 0, fetched.stderr)
  const built = spawnSync(process.execPath, [
    'scripts/build-rc2-connection-compat.mjs',
    '--source-dir', path.join(root, 'source/deepseek-harness-b150a551'),
    '--output-dir', path.join(root, 'connection'),
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(built.status, 0, built.stderr)
  await symlink(path.join(REPO, 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const bundle = path.join(root, 'connection.mjs')
  const bundled = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(root, 'connection/src/index.ts'), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${bundle}`,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(bundled.status, 0, bundled.stderr)
  return import(`${pathToFileURL(bundle).href}?fence=${Date.now()}`)
}

/**
 * A real Cordis root context with a stub webServer, so `apply()` runs its real
 * service construction and real route registration.
 */
async function realContext() {
  const { Context } = await import('@deepseek-ai/cordis')
  const registered = { route: undefined, upgrades: [] }
  const ctx = new Context()
  ctx.provide('webServer', undefined, true)
  ctx.webServer = {
    register(route) { registered.route = route; return () => { registered.route = undefined } },
    registerUpgrade(route) { registered.upgrades.push(route); return () => {} },
  }
  return { ctx, registered }
}

/**
 * Serves the registered route over a real HTTP server, so `bridge()` receives a
 * genuine IncomingMessage/ServerResponse pair (it consumes the body with
 * `for await (const chunk of req)` and streams the response back).
 */
async function serveRoute(route) {
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => { void route.handler(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    port,
    async close() { await new Promise(resolve => server.close(resolve)) },
    async post(pathname, { origin, body }) {
      const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(origin === undefined ? {} : { origin, 'sec-fetch-site': 'cross-site' }),
        },
        body,
      })
      return { status: response.status, body: await response.text() }
    },
  }
}

test('the federation middleware sits inside the Host/Origin trust fence', { timeout: 300_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'connection-fence-'))
  let server
  try {
    const mod = await buildPatchedConnection(root)
    const { ctx, registered } = await realContext()

    // Real apply(): real service construction, real route, real fence.
    mod.apply(ctx, { trustedHosts: [] })
    assert.ok(registered.route, 'apply() must register the /api prefix route')
    assert.equal(registered.route.path, '/api')

    assert.ok(ctx.get('connection'), 'apply() must expose the connection service')

    // Federation installs its single outer middleware from its OWN fiber, the
    // way a plugin does: the Cordis service getter binds cleanup to the
    // accessing context, so ownership is released when that fiber is disposed.
    const seen = []
    const owner = ctx.inject(['connection'], child => {
      child.connection.api.use(async request => {
        seen.push(new URL(request.url).pathname)
        return new Response('federation', { status: 209 })
      })
    })
    await new Promise(resolve => setTimeout(resolve, 200))

    // 1) A cross-site request must be rejected by the fence BEFORE the
    //    middleware runs: federation never observes untrusted traffic.
    server = await serveRoute(registered.route)
    const crossSite = await server.post('/api/future/identity', {
      origin: 'https://evil.example',
      body: JSON.stringify({ sessionId: 'fed1:vm-a:s:Zm9v' }),
    })
    assert.equal(crossSite.status, 403, `expected the fence to reject: ${JSON.stringify(crossSite)}`)
    assert.match(crossSite.body, /forbidden/)
    assert.deepEqual(seen, [], 'the federation middleware must not see an untrusted request')

    // 2) A same-origin request passes the fence and reaches the middleware.
    const trusted = await server.post('/api/future/identity', {
      body: JSON.stringify({ sessionId: 'fed1:vm-a:s:Zm9v' }),
    })
    assert.equal(trusted.status, 209, `a trusted request must reach federation: ${JSON.stringify(trusted)}`)
    assert.deepEqual(seen, ['/api/future/identity'],
      `a trusted request must reach the middleware: ${JSON.stringify(trusted)}`)

    // 3) Disposing federation ownership restores the untouched native path,
    //    and the fence still rejects untrusted requests.
    await owner.dispose()
    await new Promise(resolve => setTimeout(resolve, 200))
    seen.length = 0
    const afterDispose = await server.post('/api/future/identity', {
      origin: 'https://evil.example',
      body: JSON.stringify({ sessionId: 'native' }),
    })
    assert.equal(afterDispose.status, 403)
    assert.deepEqual(seen, [])

    // 4) Ownership is exclusive while held, and reusable once the owning fiber
    //    is disposed — the seam cannot be double-claimed.
    const firstOwner = ctx.inject(['connection'], child => {
      child.connection.api.use(async (request, next) => next.fetch(request))
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    // The refusal surfaces inside the second fiber, so capture it there.
    let refusal
    const secondOwner = ctx.inject(['connection'], child => {
      try {
        child.connection.api.use(async (request, next) => next.fetch(request))
      } catch (error) {
        refusal = error
      }
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.match(String(refusal?.message), /already has an outer middleware/,
      'a second concurrent middleware must be refused')
    await secondOwner.dispose()
    await firstOwner.dispose()
    await new Promise(resolve => setTimeout(resolve, 200))
    const reclaimed = ctx.inject(['connection'], child => {
      child.connection.api.use(async (request, next) => next.fetch(request))
    })
    await new Promise(resolve => setTimeout(resolve, 200))
    await reclaimed.dispose()
  } finally {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
})
