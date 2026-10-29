import { expect, it } from 'vitest'

// Opt-in read-only probe of the existing Host; no credential, session or model creation.
it.skipIf(process.env.MEMEX_TEST_LIVE_CONNECTION !== '1')('EVAL-032: 未鉴权或跨源请求被拒绝', async () => {
  const url = 'http://127.0.0.1:3080/dsh-memex/eval/status'
  for (const [headers, expected] of [
    [{}, 401],
    [{ origin: 'https://untrusted.invalid' }, 403],
    [{ host: 'untrusted.invalid:3080', origin: 'http://untrusted.invalid:3080' }, 403],
  ] as const) {
    const response = await fetch(url, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ type: 'client-request', rpcId: 'memex-acceptance-denied', method: 'eval/status', payload: {} }),
    })
    try {
      expect(response.status).toBe(expected)
      expect(response.headers.get('location')).toBeNull()
    } finally { await response.body?.cancel() }
  }
})
