/**
 * Host-side download of one Lottie source from a URL.
 *
 * Why the Host and not the browser: the owner's browser network may not reach
 * the CDN that the DSH Host can reach (the original motivation: fonts.gstatic
 * was blocked in the browser but fetched fine on the Host). The browser also
 * faces CORS, which the Host does not.
 *
 * This is the ONLY outbound request Pet ever makes on behalf of an owner
 * action, so it is written as a small SSRF guard rather than a generic fetch:
 *
 * - HTTPS + default port only, no credentials, at most 3 redirects;
 * - every hop re-resolves and requires EVERY address to be public;
 * - the validated addresses are PINNED into the TLS connection through a
 *   custom `lookup`, so neither a second DNS answer nor an environment proxy
 *   can silently connect somewhere the check did not see (see the dedicated
 *   agent below);
 * - one overall deadline, a 512 KiB response cap and a JSON-ish content-type
 *   allowlist.
 *
 * The downloaded bytes then go through the same `validateLottieSource` as a
 * pasted source, so this module is about "may I fetch this", not "is this a
 * Lottie".
 */

import type { LookupAddress, LookupOptions } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { Agent, request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import { PetError } from './errors.js'
import { MAX_EXPRESSION_SOURCE_BYTES } from '../wire.js'

/** Redirect hops this downloader will follow. */
export const MAX_EXPRESSION_URL_REDIRECTS = 3

/** Overall deadline for one URL import (DNS + all redirects + download). */
export const EXPRESSION_URL_TIMEOUT_MS = 10_000

/** Deadline for one DNS resolution inside the overall deadline. */
export const EXPRESSION_DNS_TIMEOUT_MS = 4_000

/** Content types a Lottie JSON source may plausibly be served as. */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/json',
  'text/json',
  'text/plain',
  'application/octet-stream',
  'binary/octet-stream',
])

/** Hostnames that never denote a public CDN. */
const DISALLOWED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan']

/**
 * Headers a download may carry: no cookies, no credentials, no referer, and
 * no compression negotiation (a compressed body would otherwise be decoded as
 * UTF-8 and reported as invalid content instead of a download error).
 */
const DOWNLOAD_HEADERS: Readonly<Record<string, string>> = {
  accept: 'application/json, text/plain;q=0.9, application/octet-stream;q=0.8',
  'accept-encoding': 'identity',
  'user-agent': 'dsh-pet/0.2.1',
}

/**
 * Dedicated agent for URL imports.
 *
 * Two reasons it is not the global agent: a keep-alive socket could be reused
 * from a previous connection (bypassing this request's `lookup`), and Node's
 * env-proxy mode (`NODE_USE_ENV_PROXY`) tunnels through the proxy without
 * consulting `lookup` at all. The trade-off is explicit: URL import does NOT
 * use `HTTP(S)_PROXY`; an environment that can only reach the internet
 * through a proxy gets a diagnostic instead of an unpinned connection.
 *
 * Exported so a committed regression test can prove the downloader does not
 * borrow `https.globalAgent` (which is keep-alive and may be proxy-routed).
 */
export const EXPRESSION_REQUEST_AGENT = new Agent({ keepAlive: false })

/** One HTTP response, reduced to what the downloader needs. */
export interface ExpressionHttpResponse {
  readonly status: number
  readonly headers: { readonly get: (name: string) => string | null }
  /** Body chunks; `null` means the response offered no stream. */
  readonly body: AsyncIterable<Uint8Array> | null
  /** Release the underlying socket early (redirects/errors may skip the body). */
  readonly destroy?: () => void
}

/** A validated address family/address pair. */
export interface PublicAddress {
  readonly address: string
  readonly family: 4 | 6
}

/** The validated connect targets for one host (every one is public). */
export interface PublicTarget {
  readonly addresses: readonly PublicAddress[]
}

/** One connection-pinned GET. */
export type ExpressionRequest = (
  url: URL,
  target: PublicTarget,
  timeoutMs: number,
) => Promise<ExpressionHttpResponse>

/** Injectable network surface, so tests never touch the real network. */
export interface ExpressionFetchDeps {
  /** Perform one GET; the validated addresses are already pinned by the caller. */
  readonly request: ExpressionRequest
  /** Resolve a hostname to every address it currently maps to. */
  readonly lookup: (hostname: string) => Promise<readonly string[]>
}

/**
 * Build a `lookup` implementation that only ever returns validated addresses.
 *
 * Node's `net.connect` calls this in two shapes: `{ all: true }` (Happy
 * Eyeballs / `autoSelectFamily`, expects an address array) and the legacy
 * single-address shape. Returning the wrong shape makes every hostname URL
 * fail with `ERR_INVALID_IP_ADDRESS`, so both are handled explicitly.
 * @param addresses - Validated public addresses, in preference order.
 * @returns a lookup function for `https.request` options.
 */
export type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) => void

export function createPinnedLookup(addresses: readonly PublicAddress[]): PinnedLookup {
  return (_hostname, options, callback) => {
    if (options.all === true) {
      callback(
        null,
        addresses.map(item => ({ address: item.address, family: item.family })),
      )
      return
    }
    const first = addresses[0]
    if (first === undefined) {
      callback(Object.assign(new Error('no validated address'), { code: 'ENOTFOUND' }), '')
      return
    }
    callback(null, first.address, first.family)
  }
}

/** Open one TLS connection to the pinned addresses while using the URL host. */
export const defaultRequest: ExpressionRequest = (url, target, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: DOWNLOAD_HEADERS,
        // TLS still uses the URL host for SNI and certificate verification.
        lookup: createPinnedLookup(target.addresses),
        agent: EXPRESSION_REQUEST_AGENT,
        signal: AbortSignal.timeout(timeoutMs),
      },
      response => {
        resolve({
          status: response.statusCode ?? 0,
          headers: {
            get: name => {
              const value = response.headers[name.toLowerCase()]
              return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
            },
          },
          body: response as AsyncIterable<Uint8Array>,
          destroy: () => response.destroy(),
        })
      },
    )
    req.on('error', reject)
    req.end()
  })

const DEFAULT_DEPS: ExpressionFetchDeps = {
  request: defaultRequest,
  lookup: async hostname => {
    const records = await lookup(hostname, { all: true, verbatim: true })
    return records.map(record => record.address)
  },
}

/** Reject a URL that is not a plain HTTPS target. */
function invalidUrl(message: string): never {
  throw new PetError('INVALID_REQUEST', `URL 导入被拒绝：${message}`)
}

/** Reject a download that failed for network/content reasons. */
function fetchFailed(message: string): never {
  throw new PetError('EXPRESSION_FETCH_FAILED', `下载动画失败：${message}`)
}

/** Parse a dotted IPv4 literal into four octets, or `undefined`. */
function parseIpv4(value: string): number[] | undefined {
  const parts = value.split('.').map(part => Number(part))
  if (parts.length !== 4) return undefined
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return parts
}

/** Whether one IPv4 address (octets) must not be contacted. */
function ipv4Disallowed(parts: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = parts
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 (CGNAT)
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast + reserved + broadcast
  )
}

/**
 * Parse an IPv6 literal into 16 bytes (compressed forms and embedded dotted
 * IPv4 included), or `undefined` when it is not an IPv6 literal.
 */
function parseIpv6(value: string): number[] | undefined {
  let text = value.toLowerCase()
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  const halves = text.split('::')
  if (halves.length > 2) return undefined

  const parseGroups = (part: string): number[] | undefined => {
    if (part === '') return []
    const groups = part.split(':')
    const result: number[] = []
    for (const [index, group] of groups.entries()) {
      if (index === groups.length - 1 && group.includes('.')) {
        const octets = parseIpv4(group)
        if (octets === undefined) return undefined
        result.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0))
        result.push(((octets[2] ?? 0) << 8) | (octets[3] ?? 0))
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined
      result.push(Number.parseInt(group, 16))
    }
    return result
  }

  const head = parseGroups(halves[0] ?? '')
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : []
  if (head === undefined || tail === undefined) return undefined
  let groups: number[]
  if (halves.length === 1) {
    if (head.length !== 8) return undefined
    groups = head
  } else {
    if (head.length + tail.length > 8) return undefined
    groups = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail]
  }
  const bytes: number[] = []
  for (const group of groups) bytes.push((group >> 8) & 0xff, group & 0xff)
  return bytes
}

/** Whether one IPv6 address (16 bytes) must not be contacted. */
function ipv6Disallowed(bytes: readonly number[]): boolean {
  const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = bytes
  const embedded = (start: number): boolean =>
    ipv4Disallowed([bytes[start] ?? 0, bytes[start + 1] ?? 0, bytes[start + 2] ?? 0, bytes[start + 3] ?? 0])
  const allZero = (from: number, to: number): boolean =>
    bytes.slice(from, to).every(byte => byte === 0)

  if (allZero(0, 16)) return true // ::
  if (allZero(0, 15) && bytes[15] === 1) return true // ::1
  if ((b0 & 0xfe) === 0xfc) return true // fc00::/7 unique local
  if (b0 === 0xfe && (b1 & 0xc0) === 0x80) return true // fe80::/10 link-local
  if (b0 === 0xfe && (b1 & 0xc0) === 0xc0) return true // fec0::/10 site-local
  if (b0 === 0xff) return true // multicast
  if (b0 === 0x20 && b1 === 0x01 && b2 === 0x0d && b3 === 0xb8) return true // 2001:db8::/32
  if (b0 === 0x20 && b1 === 0x01 && b2 === 0 && b3 === 0) return true // 2001::/32 Teredo

  const first10Zero = allZero(0, 10)
  if (first10Zero && bytes[10] === 0xff && bytes[11] === 0xff) return embedded(12) // ::ffff:0:0/96
  if (allZero(0, 12)) return true // ::/96 incl. IPv4-compatible (deprecated) and ::/::1
  if (b0 === 0x00 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b) return embedded(12) // 64:ff9b::/96 NAT64
  if (b0 === 0x20 && b1 === 0x02) return embedded(2) // 2002::/16 6to4
  return false
}

/**
 * Whether an IP address is loopback, private, link-local, metadata, mapped to
 * one of those, or otherwise reserved.
 *
 * Deliberately broad: a false positive only costs one supported CDN, while a
 * false negative lets a pasted URL reach the Host's own network. IPv4-mapped
 * addresses are unwrapped in BOTH textual forms (`::ffff:127.0.0.1` and the
 * WHATWG-normalized hex form `::ffff:7f00:1`).
 * @param address - IPv4 or IPv6 literal.
 * @returns whether the address must not be contacted.
 */
export function isDisallowedAddress(address: string): boolean {
  const value = address.trim().toLowerCase()
  const version = isIP(value)
  if (version === 4) {
    const octets = parseIpv4(value)
    return octets === undefined ? true : ipv4Disallowed(octets)
  }
  if (version === 6) {
    const bytes = parseIpv6(value)
    return bytes === undefined ? true : ipv6Disallowed(bytes)
  }
  return true
}

/** Normalize a hostname for allow/deny comparisons (IDNA casing, trailing dot). */
function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

/**
 * Parse and shape-check a candidate URL.
 * @param raw - Owner-supplied URL (absolute, or resolved against a redirect).
 * @returns the parsed URL.
 */
export function parseExpressionUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    invalidUrl('不是合法的 URL')
  }
  if (url.protocol !== 'https:') invalidUrl('只允许 https://')
  if (url.username !== '' || url.password !== '') invalidUrl('不允许携带用户名或密码')
  if (url.port !== '' && url.port !== '443') invalidUrl('只允许默认 443 端口')
  if (normalizedHostname(url) === '') invalidUrl('缺少主机名')
  return url
}

/** Resolve with a timeout so a hung DNS server cannot exceed the deadline. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('dns-timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Resolve a URL's host and prove every address is public.
 *
 * Every address is checked (not just the first): a hostname with one private
 * address must not be reachable just because another one is public. The whole
 * validated set is returned and then pinned into the connection, so the check
 * and the connect share one DNS answer.
 * @param url - Already shape-checked URL.
 * @param deps - Injected resolver.
 * @param timeoutMs - DNS deadline (bounded by the overall import deadline).
 * @returns the validated addresses.
 */
export async function resolvePublicTarget(
  url: URL,
  deps: ExpressionFetchDeps,
  timeoutMs: number = EXPRESSION_DNS_TIMEOUT_MS,
): Promise<PublicTarget> {
  const hostname = normalizedHostname(url)
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    DISALLOWED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) {
    invalidUrl('不允许访问本机或内网主机')
  }
  const literal = isIP(hostname)
  if (literal !== 0) {
    if (isDisallowedAddress(hostname)) invalidUrl('不允许访问内网或保留地址')
    return { addresses: [{ address: hostname, family: literal === 6 ? 6 : 4 }] }
  }
  let addresses: readonly string[]
  try {
    addresses = await withTimeout(deps.lookup(hostname), timeoutMs)
  } catch {
    fetchFailed(`无法解析主机名 ${hostname}`)
  }
  if (addresses.length === 0) fetchFailed(`无法解析主机名 ${hostname}`)
  if (addresses.some(address => isDisallowedAddress(address))) {
    invalidUrl(`主机 ${hostname} 解析到内网或保留地址`)
  }
  const targets = addresses
    .map(address => ({ address, family: isIP(address) === 6 ? (6 as const) : (4 as const) }))
    .filter(address => address.family === 4 || address.family === 6)
  if (targets.length === 0) fetchFailed(`无法解析主机名 ${hostname}`)
  return { addresses: targets }
}

/** Read a response body with a hard byte cap, converting stream errors. */
async function readBounded(
  response: ExpressionHttpResponse,
  limit: number,
): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > limit) {
    response.destroy?.()
    fetchFailed(`内容声明 ${declared} 字节，超过 ${limit} 字节上限`)
  }
  if (response.body === null) {
    // A response with no stream cannot be size-checked before reading, so
    // refuse rather than guess.
    response.destroy?.()
    fetchFailed('响应没有可读取的内容')
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of response.body) {
      total += chunk.byteLength
      if (total > limit) {
        response.destroy?.()
        fetchFailed(`内容超过 ${limit} 字节上限`)
      }
      chunks.push(chunk)
    }
  } catch (error) {
    if (error instanceof PetError) throw error
    fetchFailed('读取响应内容失败')
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}

/**
 * Download one candidate Lottie source.
 *
 * Returns the response text; the caller MUST still run it through the shared
 * source validator before storing it. Throws `INVALID_REQUEST` for a URL that
 * must not be contacted and `EXPRESSION_FETCH_FAILED` for a download that
 * could not produce a usable JSON-ish body.
 * @param rawUrl - Owner-supplied absolute URL.
 * @param deps - Injected network surface (tests use a fake).
 * @returns the downloaded text.
 */
export async function fetchExpressionSource(
  rawUrl: string,
  deps: ExpressionFetchDeps = DEFAULT_DEPS,
): Promise<string> {
  const deadline = Date.now() + EXPRESSION_URL_TIMEOUT_MS
  let url = parseExpressionUrl(rawUrl)
  for (let hop = 0; hop <= MAX_EXPRESSION_URL_REDIRECTS; hop += 1) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) fetchFailed('请求超时')
    const target = await resolvePublicTarget(url, deps, Math.min(remaining, EXPRESSION_DNS_TIMEOUT_MS))

    let response: ExpressionHttpResponse
    try {
      response = await deps.request(url, target, Math.max(1, deadline - Date.now()))
    } catch (error) {
      if (error instanceof PetError) throw error
      fetchFailed('请求失败或超时')
    }

    if (response.status >= 300 && response.status < 400) {
      response.destroy?.()
      if (hop === MAX_EXPRESSION_URL_REDIRECTS) fetchFailed('重定向次数过多')
      const location = response.headers.get('location')
      if (location === null || location.trim() === '') fetchFailed('重定向缺少 Location')
      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        fetchFailed('重定向目标不是合法 URL')
      }
      url = parseExpressionUrl(next.href)
      continue
    }

    if (response.status < 200 || response.status >= 300) {
      response.destroy?.()
      fetchFailed(`下载失败（HTTP ${response.status}）`)
    }
    const contentType = ((response.headers.get('content-type') ?? '').split(';')[0] ?? '')
      .trim()
      .toLowerCase()
    if (contentType !== '' && !ALLOWED_CONTENT_TYPES.has(contentType)) {
      response.destroy?.()
      fetchFailed(`内容类型不受支持（${contentType}）`)
    }
    const encoding = (response.headers.get('content-encoding') ?? '').trim().toLowerCase()
    if (encoding !== '' && encoding !== 'identity') {
      response.destroy?.()
      fetchFailed(`内容编码不受支持（${encoding}）`)
    }
    return await readBounded(response, MAX_EXPRESSION_SOURCE_BYTES)
  }
  fetchFailed('重定向次数过多')
}
