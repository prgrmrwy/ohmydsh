import { Agent, fetch as directFetch } from 'undici'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
export interface ConnectionIdentity { baseUrl: string; key: string }
const allowed = new Set(['GET /models', 'POST /responses', 'POST /chat/completions', 'GET /magpie/quotas/cards', 'POST /magpie/quotas/refresh'])
export class GatewayTransport {
  readonly signal = new AbortController()
  private readonly agent = new Agent()
  async request(identity: ConnectionIdentity, method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const base = new URL(identity.baseUrl)
    const url = /^https?:/.test(path) ? new URL(path) : new URL(identity.baseUrl + path)
    const relative = url.pathname.slice(base.pathname.length)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + '/') || url.username || url.password || url.hash || !allowed.has(`${method} ${relative}`)) throw new Error('MAGPIE_ENDPOINT_FORBIDDEN')
    if (url.search && !(method === 'POST' && relative === '/magpie/quotas/refresh' && [...url.searchParams.keys()].every(k => k === 'provider' || k === 'user'))) throw new Error('MAGPIE_QUERY_FORBIDDEN')
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(attributionHeaders())) headers.set(key, value)
    headers.set('authorization', `Bearer ${identity.key}`)
    try {
      return await directFetch(url, { ...init, method, headers: Object.fromEntries(headers), redirect: 'error', dispatcher: this.agent,
        signal: AbortSignal.any([this.signal.signal, ...(init.signal ? [init.signal] : [])]),
      } as Parameters<typeof directFetch>[1]) as unknown as Response
    } catch (error) {
      if (String((error as { cause?: unknown })?.cause).includes('redirect')) throw new Error('网关返回了被禁止的重定向')
      throw error
    }
  }
  fetchFor(identity: ConnectionIdentity): typeof fetch {
    return async (input, init) => {
      const request = new Request(input, init)
      return this.request(identity, request.method, request.url, { method: request.method, headers: request.headers, signal: request.signal,
        ...(request.body ? { body: await request.text() } : {}),
      })
    }
  }
  async dispose() { this.signal.abort(); await this.agent.destroy() }
}
