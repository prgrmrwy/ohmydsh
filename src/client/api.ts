/**
 * The only way the web half reaches the host: the four D10 resources under
 * `/api/dsh-magpie-connector/`. Responses are bare JSON; errors are non-2xx with
 * `{error: string}`. Injected so tests replace it without touching `fetch`.
 */
export type Resource = 'settings' | 'cards' | 'speed' | 'line-check' | 'latency' | 'reset'
export interface ApiRequest { method: 'GET' | 'POST'; path: Resource; query?: Record<string, string>; body?: unknown }
export interface ApiResponse { status: number; body: unknown }
export type Api = (request: ApiRequest) => Promise<ApiResponse>

const TIMEOUT_MS = 30_000
/**
 * Spending a reset outlives the generic budget: the host waits up to 45s for the
 * gateway, which itself may spend 20s and then re-read the account for 15s. The
 * browser must not give up first — a timeout here reads as "outcome unknown".
 */
const RESET_TIMEOUT_MS = 60_000

export function createFetchApi(base = '/api/dsh-magpie-connector/'): Api {
  return async ({ method, path, query, body }) => {
    const search = query ? `?${new URLSearchParams(query).toString()}` : ''
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), path === 'reset' ? RESET_TIMEOUT_MS : TIMEOUT_MS)
    try {
      const response = await fetch(`${base}${path}${search}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      let parsed: unknown = null
      try { parsed = await response.json() } catch { parsed = null }
      return { status: response.status, body: parsed }
    } finally {
      clearTimeout(timer)
    }
  }
}

export const isOk = (response: ApiResponse) => response.status >= 200 && response.status < 300

/** Error text of a failed response: the host's (already redacted) reason plus the status. */
export function failureText(response: ApiResponse): string {
  const reason = (response.body as { error?: unknown } | null)?.error
  return typeof reason === 'string' && reason ? `HTTP ${response.status}：${reason}` : `HTTP ${response.status}`
}

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)
