import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import {
  assertRouteInventory,
  createFederationPreFallbackHandler,
  exactRoutesFromProtocol,
  registerRouteTransaction,
} from '../scripts/federation-route-gate.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL = path.join(REPO, 'openspec/changes/federated-dsh-control-plane/checking/protocol')
const json = async name => JSON.parse(await readFile(path.join(PROTOCOL, name), 'utf8'))

function clientRequest(method, payload) {
  return { type: 'client-request', rpcId: 'fixture-rpc', method, payload }
}

function registry() {
  const live = new Map()
  const disposed = []
  return {
    live,
    disposed,
    register(route) {
      if (live.has(route.path)) throw new Error(`conflict:${route.path}`)
      live.set(route.path, route)
      return () => {
        disposed.push(route.path)
        live.delete(route.path)
      }
    },
  }
}

test('selected rc.2 inventory contains every identity-bearing ApiProxy and Typert route', async () => {
  const protocol = await json('rc2-route-inventory.json')
  const typert = await json('rc2-typert-route-inventory.json')
  const routes = exactRoutesFromProtocol(protocol, typert)
  assertRouteInventory(routes)
  const paths = new Set(routes.map(route => route.path))
  for (const path of [
    '/api/session.history', '/api/subagent.history', '/api/agentPreset.select',
    '/api/goal.create', '/api/workspace.insertSessionBefore', '/api/respond',
    '/api/session.export', '/api/commands/execute', '/api/goals/create',
    '/api/dynamicCordisRunner/runHostHalf', '/api/messageFeedback/put',
  ]) assert.equal(paths.has(path), true, path)
  assert.equal(typert.endpoints.length, 26)
  assert.equal(typert.endpoints.filter(endpoint => endpoint.identityFields.length > 0).length, 21)
})

test('route registration transaction rolls back in reverse order at every conflict position', async () => {
  const protocol = await json('rc2-route-inventory.json')
  const typert = await json('rc2-typert-route-inventory.json')
  const routes = exactRoutesFromProtocol(protocol, typert)
  for (let conflictAt = 0; conflictAt < routes.length; conflictAt++) {
    const target = registry()
    target.live.set(routes[conflictAt].path, { occupied: true })
    await assert.rejects(
      registerRouteTransaction(route => target.register(route), routes),
      new RegExp(`conflict:${routes[conflictAt].path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    )
    assert.deepEqual([...target.live.keys()], [routes[conflictAt].path])
    assert.deepEqual(target.disposed, routes.slice(0, conflictAt).map(route => route.path).reverse())
  }
})

test('pre-fallback gate rejects known and unknown fed1 carriers without native delegation', async () => {
  const protocol = await json('rc2-route-inventory.json')
  const typert = await json('rc2-typert-route-inventory.json')
  const inventory = { exactRoutes: exactRoutesFromProtocol(protocol, typert) }
  const exactHandlers = new Map(inventory.exactRoutes.map(route => [route.path, async request => {
    const body = request.method === 'POST' ? await request.json() : null
    const hasFederated = request.method === 'POST'
      ? JSON.stringify(body).includes('fed1:')
      : [...new URL(request.url).searchParams.values()].some(value => value.startsWith('fed1:'))
    return hasFederated ? new Response('federated', { status: 209 }) : new Response('native-exact', { status: 210 })
  }]))
  let fallbackCalls = 0
  const gate = createFederationPreFallbackHandler({
    inventory,
    exactHandlers,
    fallback: { fetch: async () => { fallbackCalls++; return new Response('native-fallback', { status: 211 }) } },
  })

  for (const [path, body] of [
    ['/api/session.history', clientRequest('session.history', { sessionId: 'fed1:node:s:Zm9v' })],
    ['/api/subagent.history', clientRequest('subagent.history', { parentSessionId: 'fed1:node:s:cA', childSessionId: 'fed1:node:s:Yw', mode: 'one-shot' })],
    ['/api/commands/execute', clientRequest('commands/execute', { args: { agentId: 'fed1:node:s:Zm9v', line: '/help', images: [] } })],
    ['/api/messageFeedback/put', clientRequest('messageFeedback/put', { args: { request: { sessionId: 'fed1:node:s:Zm9v' } } })],
  ]) {
    const response = await gate.fetch(new Request(`http://127.0.0.1${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    assert.equal(response.status, 209)
  }
  for (const method of ['GET', 'HEAD']) {
    const response = await gate.fetch(new Request('http://127.0.0.1/api/session.export?sessionId=fed1%3Anode%3As%3AZm9v', { method }))
    assert.equal(response.status, 209)
  }
  const unknown = await gate.fetch(new Request('http://127.0.0.1/api/future.identityRoute', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clientRequest('future.identityRoute', { nested: { id: 'fed1:unknown:s:Zm9v' } })),
  }))
  assert.equal(unknown.status, 400)
  assert.equal(fallbackCalls, 0)

  const native = await gate.fetch(new Request('http://127.0.0.1/api/future.nativeRoute', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clientRequest('future.nativeRoute', { sessionId: 'native-session' })),
  }))
  assert.equal(native.status, 211)
  assert.equal(fallbackCalls, 1)
})

test('public rc.2 composition cannot install the generic deny gate after Typert owns the sole interceptor', async () => {
  const connection = Object.create(HostConnectionService.prototype)
  connection.interceptors = new Map()
  connection.ctx = { effect: install => install() }
  const disposeTypert = connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: null }), { authority: 'trusted-host' })
  assert.throws(
    () => connection.rpc.intercept('/api', () => true, async () => ({ ok: false, error: {} }), { authority: 'trusted-host' }),
    /already has an interceptor/,
  )
  await disposeTypert()

  const server = Object.create(WebServer.prototype)
  server.exact = new Map()
  server.prefixes = new Map()
  server.register({ kind: 'prefix', path: '/api', handler() {} })
  server.register({ kind: 'exact', path: '/api/session.history', handler() {} })
  assert.equal(server.match('/api/session.history').kind, 'exact')
  assert.equal(server.match('/api/future.identityRoute').kind, 'prefix')
  assert.throws(() => server.register({ kind: 'prefix', path: '/api', handler() {} }), /duplicate prefix route/)
})
