import { Agent, fetch as directFetch } from 'undici'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
export interface ConnectionIdentity { baseUrl: string; key: string; accessClientId?: string; accessClientSecret?: string }
export function validateIdentity(identity: ConnectionIdentity) {
  const { accessClientId: id = '', accessClientSecret: secret = '' } = identity
  if (!!id !== !!secret) throw new Error('MAGPIE_ACCESS_PAIR_REQUIRED')
  if ([id, secret].some(value => value && (value.length > 512 || /[^\x21-\x7e]/.test(value)))) throw new Error('MAGPIE_ACCESS_INVALID')
  if (id && identity.baseUrl && new URL(identity.baseUrl).protocol !== 'https:') throw new Error('MAGPIE_ACCESS_HTTPS_REQUIRED')
}
const allowed = new Set(['GET /models', 'POST /responses', 'POST /chat/completions', 'GET /magpie/quotas/cards', 'POST /magpie/quotas/refresh'])
export class GatewayTransport {
  readonly signal = new AbortController()
  private readonly agent = new Agent()
  async request(identity: ConnectionIdentity, method: string, path: string, init: RequestInit = {}): Promise<Response> {
    validateIdentity(identity)
    const base = new URL(identity.baseUrl)
    const url = /^https?:/.test(path) ? new URL(path) : new URL(identity.baseUrl + path)
    const relative = url.pathname.slice(base.pathname.length)
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname + '/') || url.username || url.password || url.hash || !allowed.has(`${method} ${relative}`)) throw new Error('MAGPIE_ENDPOINT_FORBIDDEN')
    if (url.search && !(method === 'POST' && relative === '/magpie/quotas/refresh' && [...url.searchParams.keys()].every(k => k === 'provider' || k === 'user'))) throw new Error('MAGPIE_QUERY_FORBIDDEN')
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(attributionHeaders())) headers.set(key, value)
    headers.set('authorization', `Bearer ${identity.key}`)
    headers.delete('CF-Access-Client-Id')
    headers.delete('CF-Access-Client-Secret')
    if (identity.accessClientId && identity.accessClientSecret) {
      headers.set('CF-Access-Client-Id', identity.accessClientId)
      headers.set('CF-Access-Client-Secret', identity.accessClientSecret)
    }
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
