import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECKING = path.join(REPO, 'openspec/changes/federated-dsh-control-plane/checking')
const json = async relative => JSON.parse(await readFile(path.join(CHECKING, relative), 'utf8'))

async function buildFixture(root) {
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
  const bundled = spawnSync(path.join(REPO, 'node_modules/.bin/esbuild'), [
    path.join(root, 'connection/src/index.ts'), '--bundle', '--platform=node', '--format=esm',
    '--packages=external', `--outfile=${path.join(root, 'connection.mjs')}`,
  ], { cwd: REPO, encoding: 'utf8' })
  assert.equal(bundled.status, 0, bundled.stderr)
  return import(`${pathToFileURL(path.join(root, 'connection.mjs')).href}?fixture=${Date.now()}`)
}

function testService(Service) {
  const service = Object.create(Service.prototype)
  service.interceptors = new Map()
  service.ctx = {
    effect(install) {
      const dispose = install()
      return async () => { await dispose?.() }
    },
  }
  return service
}

test('Connection compatibility manifest and patch are fixed-source and minimal', async () => {
  const manifest = await json('upstream/rc2-connection-source-manifest.json')
  const patch = await readFile(path.join(CHECKING, 'upstream', manifest.patch.path), 'utf8')
  assert.equal(manifest.releaseCommit, 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e')
  assert.equal(manifest.archive.sha256, '2e226ab71ebf1050b1ba63202aa9f8e6d988f337ab299506069ff5a0015dd09e')
  assert.equal(manifest.patch.sha256, 'e1b6c2d17a5efa05918c8044b011874c363c3f2cd7a4d83b7a2b5990aa87d0b9')
  assert.deepEqual(manifest.patch.outputs.map(output => output.path), ['src/index.ts', 'src/rpc.ts', 'src/rpc-host.ts'])
  assert.match(patch, /readonly api: HostConnectionApi/)
  assert.match(patch, /connection\.handleApiRequest\(request, apiHandler\)/)
  assert.match(patch, /already has an outer middleware/)
  assert.doesNotMatch(patch, /^diff --git a\/src\/api-request-trust\.ts/m)
  assert.doesNotMatch(patch, /^diff --git a\/src\/http-bridge\.ts/m)
  assert.doesNotMatch(patch, /^diff --git a\/src\/websocket-downlink\.ts/m)
})

test('Connection source fetcher fails closed on offline cache miss', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'connection-offline-'))
  try {
    const result = spawnSync(process.execPath, [
      'scripts/fetch-rc2-connection-source.mjs', '--offline',
      '--cache-dir', path.join(root, 'cache'), '--output-dir', path.join(root, 'source'),
    ], { cwd: REPO, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /offline connection source cache miss or corruption/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('patched Connection runs outer middleware before composed Typert-first fallback and disposes ownership', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'connection-runtime-'))
  try {
    const { HostConnectionService } = await buildFixture(root)
    const service = testService(HostConnectionService)
    const calls = []
    const fallback = { fetch: async request => { calls.push(`fallback:${new URL(request.url).pathname}`); return new Response('fallback', { status: 202 }) } }
    const inner = service.createSharedFetchHandler('/api', fallback)
    const composed = { fetch: request => service.handleApiRequest(request, inner) }
    const disposeTypert = service.rpc.intercept(
      '/api', endpoint => endpoint === 'goals/create',
      async endpoint => { calls.push(`typert:${endpoint}`); return { ok: true, value: 'typert' } },
      { authority: 'trusted-host' },
    )
    const disposeOuter = service.api.use(async (request, next) => {
      calls.push(`outer:${new URL(request.url).pathname}`)
      if ((await request.clone().text()).includes('fed1:')) return new Response('federated', { status: 209 })
      return next.fetch(request)
    })
    assert.throws(() => service.api.use(async (_request, next) => next.fetch(_request)), /already has an outer middleware/)

    const typertBody = { type: 'client-request', rpcId: 'r1', method: 'goals/create', payload: { agentId: 'native' } }
    const typert = await composed.fetch(new Request('http://127.0.0.1/api/goals/create', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(typertBody),
    }))
    assert.equal(typert.status, 200)
    assert.deepEqual(calls, ['outer:/api/goals/create', 'typert:goals/create'])

    calls.length = 0
    const nativeUnknown = await composed.fetch(new Request('http://127.0.0.1/api/future/native', {
      method: 'POST', body: JSON.stringify({ sessionId: 'native' }),
    }))
    assert.equal(nativeUnknown.status, 202)
    assert.deepEqual(calls, ['outer:/api/future/native', 'fallback:/api/future/native'])

    calls.length = 0
    const federatedUnknown = await composed.fetch(new Request('http://127.0.0.1/api/future/identity', {
      method: 'POST', body: JSON.stringify({ nested: { sessionId: 'fed1:unknown:s:Zm9v' } }),
    }))
    assert.equal(federatedUnknown.status, 209)
    assert.deepEqual(calls, ['outer:/api/future/identity'])

    calls.length = 0
    const factoryAlone = await inner.fetch(new Request('http://127.0.0.1/api/future/identity', {
      method: 'POST', body: JSON.stringify({ sessionId: 'fed1:unknown:s:Zm9v' }),
    }))
    assert.equal(factoryAlone.status, 202)
    assert.deepEqual(calls, ['fallback:/api/future/identity'])

    await disposeOuter()
    calls.length = 0
    const afterDispose = await composed.fetch(new Request('http://127.0.0.1/api/future/identity', {
      method: 'POST', body: JSON.stringify({ sessionId: 'fed1:unknown:s:Zm9v' }),
    }))
    assert.equal(afterDispose.status, 202)
    assert.deepEqual(calls, ['fallback:/api/future/identity'])
    await disposeTypert()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Connection compatibility builder preserves last-known-good output on source mismatch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'connection-last-good-'))
  try {
    await buildFixture(root)
    const output = path.join(root, 'connection')
    const sentinel = path.join(output, 'sentinel.txt')
    await writeFile(sentinel, 'last-known-good', 'utf8')
    const changed = path.join(root, 'changed')
    await mkdir(path.join(changed, 'packages/client'), { recursive: true })
    const copied = spawnSync('cp', ['-R', path.join(root, 'source/deepseek-harness-b150a551/packages/client/connection'), path.join(changed, 'packages/client/connection')], { encoding: 'utf8' })
    assert.equal(copied.status, 0, copied.stderr)
    const target = path.join(changed, 'packages/client/connection/src/rpc-host.ts')
    await writeFile(target, `${await readFile(target, 'utf8')}\n// incompatible\n`, 'utf8')
    const rejected = spawnSync(process.execPath, [
      'scripts/build-rc2-connection-compat.mjs', '--source-dir', changed, '--output-dir', output,
    ], { cwd: REPO, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /connection source src\/rpc-host\.ts/)
    assert.equal(await readFile(sentinel, 'utf8'), 'last-known-good')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
