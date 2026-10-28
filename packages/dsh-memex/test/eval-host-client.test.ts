import { expect, it } from 'vitest'
import { authenticatedEvalClient } from '../src/eval/host-client.js'
it('exchanges an explicitly supplied official launch URL and sends cookie only to its exact authority with checked RPC envelopes', async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (requests.length === 1) return new Response(null, { status: 303, headers: { location: './', 'set-cookie': 'dsh-test=synthetic; Path=/; HttpOnly; SameSite=Strict' } })
    const wire = JSON.parse(String(init?.body))
    return Response.json({ type: 'server-response', rpcId: wire.rpcId, result: { ok: true, value: { mode: 'test' } } })
  }
  const client = await authenticatedEvalClient('http://127.0.0.1:3080/?token=synthetic-launch', fetcher as typeof fetch)
  expect(await client.call('eval/status', { round: 'round-test' })).toEqual({ mode: 'test' })
  expect(requests[0]!.init?.redirect).toBe('manual')
  expect(requests[1]!.url).toBe('http://127.0.0.1:3080/dsh-memex/eval/status')
  expect(new Headers(requests[1]!.init?.headers).get('cookie')).toBe('dsh-test=synthetic')
  expect(requests[1]!.url).not.toContain('token')
})
it('rejects arbitrary hosts/paths/redirects, failed admission, and forged or failed RPC responses without leaking credential text', async () => {
  let contacted = 0
  for (const url of ['https://external.example/?token=secret-fixture', 'http://127.0.0.1:3080/private?token=secret-fixture', 'http://127.0.0.1:3080/?token=secret-fixture&extra=x']) {
    await expect(authenticatedEvalClient(url, (async () => { contacted++; throw Error() }) as typeof fetch)).rejects.not.toThrow(/secret-fixture/)
  }
  expect(contacted).toBe(0)
  for (const response of [new Response(null, { status: 401 }), new Response(null, { status: 303, headers: { location: 'http://external.example/', 'set-cookie': 'dsh-test=x' } })]) {
    await expect(authenticatedEvalClient('http://127.0.0.1:3080/?token=secret-fixture', (async () => response) as typeof fetch)).rejects.not.toThrow(/secret-fixture/)
  }
  for (const result of [{ type: 'server-response', rpcId: 'foreign', result: { ok: true, value: {} } }, { type: 'server-response', result: { ok: false, error: { message: 'secret-fixture' } } }]) {
    let n = 0
    const client = await authenticatedEvalClient('http://127.0.0.1:3080/?token=secret-fixture', (async (_url, init) => ++n === 1
      ? new Response(null, { status: 303, headers: { location: './', 'set-cookie': 'dsh-test=x' } })
      : Response.json({ ...result, ...(result.rpcId ? {} : { rpcId: JSON.parse(String(init?.body)).rpcId }) })) as typeof fetch)
    await expect(client.call('eval/status', {})).rejects.not.toThrow(/secret-fixture/)
  }
})
