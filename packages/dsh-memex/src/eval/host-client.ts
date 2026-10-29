import { randomUUID } from 'node:crypto'
import { safeEvalFailure } from './failure.js'
import { evalHttpFetch } from './http-transport.js'

/** Explicit operator credential only; no log/cookie-store discovery or on-disk credential persistence. */
export async function authenticatedEvalClient(launch: string, fetcher: typeof fetch = evalHttpFetch): Promise<{ call(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<unknown> }> {
  let url: URL
  try { url = new URL(launch) } catch { throw new Error('Invalid official Host launch URL') }
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.hash || [...url.searchParams.keys()].some(key => key !== 'token')
    || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) throw new Error('Expected a loopback official Host launch URL with one token')
  let response: Response
  try { response = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(10_000) }) }
  catch { throw new Error('Host authentication transport failed; credential omitted') }
  const location = response.headers.get('location')
  let target: URL | undefined
  try { target = location ? new URL(location, url) : undefined } catch { throw new Error('Invalid Host authentication redirect; credential omitted') }
  const cookies = response.headers.getSetCookie().map(value => value.split(';', 1)[0]!).filter(value => /^dsh-[A-Za-z0-9_-]+=[^;\r\n]+$/.test(value))
  await response.body?.cancel()
  if (response.status !== 303 || !target || target.origin !== url.origin || target.pathname !== '/' || target.search || target.hash || cookies.length !== 1) throw new Error('Host authentication refused or unexpected redirect/cookie')
  const cookie = cookies[0]!, origin = url.origin
  return { async call(endpoint, payload, signal) {
    if (!/^eval\/[A-Za-z]+$/.test(endpoint)) throw new Error('Unsupported eval endpoint')
    const rpcId = randomUUID()
    let result: Response
    try {
      result = await fetcher(`${origin}/dsh-memex/${endpoint}`, { method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/json', cookie, origin },
        body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }), ...(signal ? { signal } : {}) })
    } catch { throw new Error('Host eval transport interrupted; query status, never retry uncertain work automatically') }
    if (!result.ok) { await result.body?.cancel(); throw new Error(`Host eval HTTP ${result.status}; request not retried`) }
    let wire: { type?: unknown; rpcId?: unknown; result?: { ok?: unknown; value?: unknown; error?: { message?: unknown } } }
    try { wire = await result.json() as typeof wire } catch { throw new Error('Invalid Host eval response') }
    if (wire?.type !== 'server-response' || wire.rpcId !== rpcId) throw new Error('Host eval response identity mismatch; inspect round status')
    if (wire.result?.ok !== true) {
      const message = wire.result?.error?.message
      const diagnostic = safeEvalFailure(new Error(typeof message === 'string' ? message : ''))
      throw new Error(`Host eval rejected: ${diagnostic.code}; inspect round status/failure diagnostics; request not retried`)
    }
    return wire.result.value
  } }
}
