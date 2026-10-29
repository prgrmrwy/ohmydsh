import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it } from 'vitest'
import { authenticatedEvalClient } from '../src/eval/host-client.js'
import { evalHttpFetch } from '../src/eval/http-transport.js'

it('uses the real CLI transport for delayed single-submit RPCs, exact auth and abort without retry', async () => {
  let submitted = 0
  let entered!: () => void
  const arrived = new Promise<void>(resolve => { entered = resolve })
  const server = createServer(async (request, response) => {
    if (request.url === '/?token=synthetic-test') {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-test=synthetic; HttpOnly' }); response.end(); return
    }
    expect(request.headers.cookie).toBe('dsh-test=synthetic')
    expect(request.headers.origin).toBe(origin)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const wire = JSON.parse(Buffer.concat(chunks).toString())
    submitted++
    if (wire.payload.hang) { entered(); return }
    // Real socket waits for headers; no mock response bypasses the transport.
    await new Promise(resolve => setTimeout(resolve, 80))
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: 'server-response', rpcId: wire.rpcId, result: { ok: true, value: 'done' } }))
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = await authenticatedEvalClient(`${origin}/?token=synthetic-test`)
    expect(await client.call('eval/runRound', {})).toBe('done')
    const cancel = new AbortController()
    const pending = client.call('eval/runRound', { hang: true }, cancel.signal)
    const rejected = expect(pending).rejects.toThrow('transport interrupted; query status')
    await arrived
    cancel.abort()
    await rejected
    expect(submitted).toBe(2)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('bounds response bytes and preserves cancellation after headers', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200)
    if (request.url === '/large') response.end(Buffer.alloc(4 * 1024 * 1024 + 1))
    else { response.flushHeaders(); response.write('partial') }
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await expect(evalHttpFetch(`${origin}/large`)).rejects.toThrow()
    await expect(evalHttpFetch(`${origin}/partial`, { signal: AbortSignal.timeout(100) })).rejects.toThrow()
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

it('does not follow RPC redirects or retry dropped connections', async () => {
  let calls = 0
  const server = createServer((request, response) => {
    calls++
    if (request.url === '/redirect') { response.writeHead(307, { location: '/target' }); response.end() }
    else request.socket.destroy()
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    expect((await evalHttpFetch(`${origin}/redirect`)).status).toBe(307)
    await expect(evalHttpFetch(`${origin}/drop`)).rejects.toThrow()
    expect(calls).toBe(2)
    await expect(evalHttpFetch('https://external.example/')).rejects.toThrow('loopback')
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
