import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** CLI-only transport: no fetch's implicit 300s header deadline, redirects or retries. */
export const evalHttpFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Expected loopback eval transport')
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined
  return new Promise<Response>((resolve, reject) => {
    // Six tested budgets plus twelve bounded judges may legitimately exceed five minutes.
    const deadline = AbortSignal.timeout(url.pathname.endsWith('/runRound') || url.pathname.endsWith('/resumeRound') ? 3_600_000 : 30_000)
    const signal = AbortSignal.any([request.signal, deadline])
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = send(url, { method: request.method, headers: Object.fromEntries(request.headers), signal, agent: false }, incoming => {
      const chunks: Buffer[] = []
      let size = 0
      incoming.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 4 * 1024 * 1024) outgoing.destroy(new Error('Eval response too large'))
        else chunks.push(chunk)
      })
      incoming.on('error', reject)
      incoming.on('end', () => {
        try {
          const headers = new Headers()
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) headers.append(incoming.rawHeaders[i]!, incoming.rawHeaders[i + 1]!)
          const status = incoming.statusCode ?? 500
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }))
        } catch (error) { reject(error) }
      })
    })
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}
