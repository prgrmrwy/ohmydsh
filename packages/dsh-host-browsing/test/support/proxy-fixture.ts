/**
 * Shared fixture for the Host proxy tests (host-*.test.ts): the real Host
 * harness with THE PLUGIN UNDER TEST applied, one counting upstream and a
 * minted browser-session cookie.
 *
 *   const f = await startProxyFixture((req, res) => res.end('hello'))
 *   const res = await f.get('/', { headers: { 'x-extra': '1' } })   // same-origin + cookie by default
 *   f.upstream.connections                                          // upstream `connection` events
 *
 * `get()` defaults model a legitimate browser request: valid cookie,
 * `Sec-Fetch-Site: same-origin`. Pass `headers` to override or remove (undefined)
 * any of them. `target()` builds the proxy path for the upstream.
 */
import type { RequestListener } from 'node:http'
import { proxyPath } from '../../src/contract.js'
import type { Family } from '../../src/contract.js'
import { installHost } from '../../src/host/install.js'
import * as plugin from '../../src/index.js'
import type { HostInternalOptions } from '../../src/host/install.js'
import type { Context } from '@deepseek-ai/cordis'
import { startHostHarness, startUpstream } from './host-harness.js'
import type { HostHarness, RawRequestOptions, RawResponse, Upstream, UpstreamOptions } from './host-harness.js'

export type Headers = Record<string, string | string[] | undefined>

export interface ProxyFixture {
  harness: HostHarness
  upstream: Upstream
  /** `dsh-auth-…=…` for `127.0.0.1:<port>`. */
  cookie: string
  /** `/dsh-local-service/<fam>/<upstream port><rest>` */
  target(rest?: string, fam?: Family): string
  /** Authenticated same-origin request. `rest` is the upstream-relative path unless `absolute` is set. */
  get(rest: string, options?: { method?: string; headers?: Headers; body?: string | Buffer; absolute?: boolean }): Promise<RawResponse>
  /** Same defaults as `get`, but with an explicit full request path (e.g. `/dsh-local-service/sw.js`). */
  raw(options: Omit<RawRequestOptions, 'headers'> & { headers?: Headers }): Promise<RawResponse>
  dispose(): Promise<void>
}

export function defined(headers: Headers): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined))
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

export async function startProxyFixture(
  handler?: RequestListener,
  options: { upstream?: UpstreamOptions; internal?: HostInternalOptions } = {},
): Promise<ProxyFixture> {
  // Default: the real plugin entry. With internal test seams: the same installer, options injected.
  const harness = await startHostHarness({ plugin: options.internal === undefined ? plugin : { apply: (ctx: Context) => installHost(ctx, options.internal) } })
  const upstream = await startUpstream(handler, options.upstream)
  const cookie = await harness.login()
  const defaults = (): Headers => ({ cookie, 'sec-fetch-site': 'same-origin' })
  const target = (rest = '/', fam: Family = 'p') => proxyPath(fam, upstream.port, rest)
  const raw: ProxyFixture['raw'] = (opts) => harness.request({ ...opts, headers: defined({ ...defaults(), ...opts.headers }) })
  return {
    harness,
    upstream,
    cookie,
    target,
    raw,
    get: (rest, opts = {}) => raw({
      method: opts.method ?? 'GET',
      path: opts.absolute === true ? rest : target(rest),
      headers: opts.headers ?? {},
      ...(opts.body === undefined ? {} : { body: opts.body }),
    }),
    async dispose() {
      await upstream.close()
      await harness.dispose()
    },
  }
}
