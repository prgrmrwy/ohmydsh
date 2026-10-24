/**
 * URL-import SSRF guard.
 *
 * Pet's only owner-triggered outbound request is a small security boundary, so
 * every refusal is tested against an injected network: no real DNS, no real
 * HTTP, no timing flake. The happy path also proves the downloaded bytes are
 * returned verbatim for the shared source validator, and that the validated
 * address — not a second DNS answer — is what gets connected to.
 */

import { Agent, globalAgent } from 'node:https'
import { describe, expect, it } from 'vitest'
import {
  createPinnedLookup,
  EXPRESSION_REQUEST_AGENT,
  fetchExpressionSource,
  isDisallowedAddress,
  parseExpressionUrl,
  resolvePublicTarget,
  type ExpressionFetchDeps,
  type ExpressionHttpResponse,
} from '../src/host/expression-fetch.js'
import { PetError } from '../src/host/errors.js'
import { MAX_EXPRESSION_SOURCE_BYTES } from '../src/wire.js'

/** Valid minimal Lottie text used as the download body. */
const LOTTIE = JSON.stringify({ v: '5.7.0', w: 10, h: 10, layers: [{ ty: 4 }] })

/** Wrap a WHATWG Response as the downloader's minimal response shape. */
function httpResponse(response: Response): ExpressionHttpResponse {
  return {
    status: response.status,
    headers: { get: name => response.headers.get(name) },
    body: response.body as unknown as AsyncIterable<Uint8Array>,
  }
}

/** A request double that records the pinned target. */
type RecordedRequest = {
  readonly url: string
  readonly address: string
  readonly family: number
}

/** Build injectable deps with sensible public-network defaults. */
function deps(overrides: Partial<ExpressionFetchDeps> = {}): ExpressionFetchDeps & {
  calls: string[]
  requests: RecordedRequest[]
  lookups: string[]
} {
  const calls: string[] = []
  const requests: RecordedRequest[] = []
  const lookups: string[] = []
  return {
    calls,
    requests,
    lookups,
    lookup: async hostname => {
      lookups.push(hostname)
      return ['93.184.216.34']
    },
    request: async (url, target) => {
      calls.push(url.href)
      const pinned = target.addresses[0]
      requests.push({ url: url.href, address: pinned?.address ?? '', family: pinned?.family ?? 0 })
      return httpResponse(
        new Response(LOTTIE, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    },
    ...overrides,
  }
}

/** Assert a rejection carries one of the stable Pet codes. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(PetError)
    expect((error as PetError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe('address classification', () => {
  it('refuses loopback, private, link-local, metadata and reserved addresses', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.2.1',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::7f00:1', // IPv4-compatible loopback (deprecated, still mapped)
      '64:ff9b::7f00:1', // NAT64
      '2002:7f00:1::', // 6to4
      'fec0::1', // site-local
    ]) {
      expect(isDisallowedAddress(address), address).toBe(true)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const address of ['93.184.216.34', '142.250.0.1', '2606:4700::1111']) {
      expect(isDisallowedAddress(address), address).toBe(false)
    }
  })
})

describe('URL shape', () => {
  it('accepts a plain https URL with the default port', () => {
    expect(parseExpressionUrl('https://cdn.example/a.json').href).toBe('https://cdn.example/a.json')
    expect(parseExpressionUrl('https://cdn.example:443/a.json').href).toBe('https://cdn.example/a.json')
  })

  it('refuses other schemes, credentials, non-default ports and empty hosts', () => {
    for (const url of [
      'http://cdn.example/a.json',
      'file:///tmp/a.json',
      'ftp://cdn.example/a.json',
      'https://user:pass@cdn.example/a.json',
      'https://cdn.example:8443/a.json',
      'https://',
    ]) {
      expect(() => parseExpressionUrl(url), url).toThrow(PetError)
    }
  })
})

describe('SSRF guard', () => {
  it('refuses localhost names, private literals and private DNS answers', async () => {
    for (const url of [
      'https://localhost/a.json',
      'https://localhost./a.json',
      'https://app.local/a.json',
      'https://service.internal/a.json',
      'https://127.0.0.1/a.json',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.json',
      // WHATWG URL normalizes these to hex, e.g. ::ffff:7f00:1.
      'https://[::ffff:127.0.0.1]/a.json',
      'https://[::ffff:169.254.169.254]/a.json',
      'https://[::ffff:192.168.1.1]/a.json',
      'https://[::ffff:a9fe:a9fe]/a.json',
    ]) {
      const network = deps()
      await expectCode(fetchExpressionSource(url, network), 'INVALID_REQUEST')
      expect(network.calls).toEqual([])
    }

    // The rejection must say WHICH answer was refused and how to recover:
    // corporate DNS sinkholes turn public hosts into private addresses, and
    // without the answer that looks like a Pet bug.
    const internal = await fetchExpressionSource(
      'https://internal.example/a.json',
      deps({ lookup: async () => ['10.0.0.7'] }),
    ).catch((cause: unknown) => cause as { code?: string; message?: string })
    expect(internal.code).toBe('INVALID_REQUEST')
    expect(internal.message).toContain('10.0.0.7')
    expect(internal.message).toContain('fonts.gstatic.cn')
    expect(internal.message).toContain('粘贴 JSON')
    // A hostname with one public and one private answer is refused outright.
    await expectCode(
      fetchExpressionSource(
        'https://mixed.example/a.json',
        deps({ lookup: async () => ['93.184.216.34', '192.168.1.10'] }),
      ),
      'INVALID_REQUEST',
    )
  })

  it('allows proxy fake-ip answers only after an explicit opt-in', async () => {
    // Clash/mihomo fake-ip + TUN resolves EVERY hostname into 198.18.0.0/15.
    // The strict rule rejects that; the owner can opt in and only that range
    // is widened — the rest of the private/reserved space stays refused.
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({ lookup: async () => ['198.18.0.7'] }),
      ),
      'INVALID_REQUEST',
    )

    const network = deps({ lookup: async () => ['198.18.0.7'] })
    const body = await fetchExpressionSource('https://cdn.example/a.json', network, {
      allowFakeIp: true,
    })
    expect(body).toBe(LOTTIE)
    // The fake address is still the pinned target; the local TUN/proxy decides
    // where it actually goes.
    expect(network.requests).toEqual([
      { url: 'https://cdn.example/a.json', address: '198.18.0.7', family: 4 },
    ])

    for (const address of ['10.0.0.7', '127.0.0.1', '169.254.169.254', '192.168.1.1']) {
      await expectCode(
        fetchExpressionSource('https://cdn.example/a.json', deps({ lookup: async () => [address] }), {
          allowFakeIp: true,
        }),
        'INVALID_REQUEST',
      )
    }
    expect(isDisallowedAddress('198.18.0.7', true)).toBe(false)
    expect(isDisallowedAddress('198.19.255.1', true)).toBe(false)
    expect(isDisallowedAddress('203.0.113.1', true)).toBe(true)
  })

  it('refuses mapped or reserved answers from DNS and redirects', async () => {
    await expectCode(
      fetchExpressionSource(
        'https://mapped.example/a.json',
        deps({ lookup: async () => ['::ffff:7f00:1'] }),
      ),
      'INVALID_REQUEST',
    )

    const redirected = deps({
      request: async url => {
        if (url.href.includes('start.example')) {
          return httpResponse(
            new Response(null, {
              status: 302,
              headers: { location: 'https://[::ffff:a9fe:a9fe]/meta.json' },
            }),
          )
        }
        return httpResponse(
          new Response(LOTTIE, { status: 200, headers: { 'content-type': 'application/json' } }),
        )
      },
    })
    await expectCode(
      fetchExpressionSource('https://start.example/a.json', redirected),
      'INVALID_REQUEST',
    )
  })

  it('pins the validated address into the request', async () => {
    const network = deps()
    await fetchExpressionSource('https://cdn.example/a.json', network)
    expect(network.requests).toEqual([
      { url: 'https://cdn.example/a.json', address: '93.184.216.34', family: 4 },
    ])

    // A literal public address needs no DNS and is still pinned as itself.
    const literal = deps()
    await fetchExpressionSource('https://93.184.216.34/a.json', literal)
    expect(literal.lookups).toEqual([])
    expect(literal.requests[0]?.address).toBe('93.184.216.34')
  })

  it('re-checks every redirect hop and refuses private targets', async () => {
    const network = deps({
      request: async (url, target) => {
        network.calls.push(url.href)
        const pinned = target.addresses[0]
        network.requests.push({
          url: url.href,
          address: pinned?.address ?? '',
          family: pinned?.family ?? 0,
        })
        if (url.href.includes('start.example')) {
          return httpResponse(
            new Response(null, {
              status: 302,
              headers: { location: 'https://private.example/a.json' },
            }),
          )
        }
        return httpResponse(
          new Response(LOTTIE, { status: 200, headers: { 'content-type': 'application/json' } }),
        )
      },
      lookup: async hostname => (hostname.includes('private') ? ['10.0.0.5'] : ['93.184.216.34']),
    })
    await expectCode(fetchExpressionSource('https://start.example/a.json', network), 'INVALID_REQUEST')
    expect(network.calls).toEqual(['https://start.example/a.json'])
  })

  it('follows up to three public redirects and refuses more', async () => {
    let hop = 0
    const chained = deps({
      request: async url => {
        chained.calls.push(url.href)
        hop += 1
        return httpResponse(
          new Response(null, {
            status: 302,
            headers: { location: `https://cdn.example/${hop}.json` },
          }),
        )
      },
    })
    await expectCode(fetchExpressionSource('https://cdn.example/0.json', chained), 'EXPRESSION_FETCH_FAILED')
    expect(chained.calls).toHaveLength(4)

    const tooMany = deps({
      request: async url => {
        tooMany.calls.push(url.href)
        return httpResponse(
          new Response(null, { status: 302, headers: { location: 'https://cdn.example/next.json' } }),
        )
      },
    })
    await expectCode(fetchExpressionSource('https://cdn.example/a.json', tooMany), 'EXPRESSION_FETCH_FAILED')
    expect(tooMany.calls).toHaveLength(4)
  })

  it('refuses redirects without a location', async () => {
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({ request: async () => httpResponse(new Response(null, { status: 302 })) }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )
  })

  it('accepts a public redirect chain', async () => {
    const network = deps({
      request: async url => {
        network.calls.push(url.href)
        if (url.href.includes('/start')) {
          return httpResponse(
            new Response(null, { status: 302, headers: { location: '/final.json' } }),
          )
        }
        return httpResponse(
          new Response(LOTTIE, { status: 200, headers: { 'content-type': 'application/json' } }),
        )
      },
    })
    await expect(fetchExpressionSource('https://cdn.example/start', network)).resolves.toBe(LOTTIE)
    expect(network.calls).toEqual(['https://cdn.example/start', 'https://cdn.example/final.json'])
  })

  it('refuses DNS failures and empty answers', async () => {
    await expectCode(
      fetchExpressionSource('https://nxdomain.example/a.json', deps({ lookup: async () => [] })),
      'EXPRESSION_FETCH_FAILED',
    )
    await expectCode(
      fetchExpressionSource(
        'https://nxdomain.example/a.json',
        deps({
          lookup: async () => {
            throw new Error('ENOTFOUND')
          },
        }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )
  })
})

describe('download failures', () => {
  it('reports HTTP failures and unsupported content types', async () => {
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({ request: async () => httpResponse(new Response('nope', { status: 404 })) }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({
          request: async () =>
            httpResponse(
              new Response('<html></html>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
              }),
            ),
        }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )
  })

  it('caps the body by declared and actual size', async () => {
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({
          request: async () =>
            httpResponse(
              new Response('x', {
                status: 200,
                headers: {
                  'content-type': 'application/json',
                  'content-length': String(MAX_EXPRESSION_SOURCE_BYTES + 1),
                },
              }),
            ),
        }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )

    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({
          request: async () =>
            httpResponse(
              new Response('x'.repeat(MAX_EXPRESSION_SOURCE_BYTES + 1), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }),
            ),
        }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )
  })

  it('reports a rejected or timed-out request and stream failures', async () => {
    await expectCode(
      fetchExpressionSource(
        'https://cdn.example/a.json',
        deps({
          request: async () => {
            throw new DOMException('The operation was aborted.', 'AbortError')
          },
        }),
      ),
      'EXPRESSION_FETCH_FAILED',
    )

    // A stream that breaks mid-body must become a diagnostic error, not a 500.
    const broken = deps({
      request: async () => ({
        status: 200,
        headers: { get: () => null },
        body: (async function* () {
          yield Buffer.from('{"v":"5.0.0",')
          throw new Error('connection reset')
        })(),
      }),
    })
    await expectCode(fetchExpressionSource('https://cdn.example/a.json', broken), 'EXPRESSION_FETCH_FAILED')
  })

  it('returns the body for the shared source validator', async () => {
    const network = deps()
    await expect(fetchExpressionSource('https://cdn.example/a.json', network)).resolves.toBe(LOTTIE)
    expect(network.calls).toHaveLength(1)
    expect(network.lookups).toEqual(['cdn.example'])
  })
})

describe('proxy-safe transport', () => {
  it('uses a dedicated non-keepalive agent instead of the global one', () => {
    // A global-agent request could be proxy-routed or reuse a keep-alive
    // socket, either of which bypasses the pinned lookup. This contract keeps
    // the security fix from being silently reverted.
    expect(EXPRESSION_REQUEST_AGENT).toBeInstanceOf(Agent)
    expect(EXPRESSION_REQUEST_AGENT).not.toBe(globalAgent)
    expect(EXPRESSION_REQUEST_AGENT.keepAlive).toBe(false)
  })
})

describe('pinned DNS lookup contract', () => {
  it('answers both Node lookup shapes with the validated addresses only', () => {
    const lookup = createPinnedLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ])

    let single: unknown
    ;(lookup as never as (host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => void)(
      'cdn.example',
      {},
      (...args: unknown[]) => {
        single = args
      },
    )
    expect(single).toEqual([null, '93.184.216.34', 4])

    let multiple: unknown
    ;(lookup as never as (host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => void)(
      'cdn.example',
      { all: true },
      (...args: unknown[]) => {
        multiple = args
      },
    )
    expect(multiple).toEqual([
      null,
      [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700::1111', family: 6 },
      ],
    ])
  })

  it('treats a literal public IP as allowed without DNS', async () => {
    const network = deps()
    expect(network.lookups).toEqual([])
    await expect(resolvePublicTarget(new URL('https://93.184.216.34/a.json'), network)).resolves.toEqual({
      addresses: [{ address: '93.184.216.34', family: 4 }],
    })
    expect(network.lookups).toEqual([])
  })
})
