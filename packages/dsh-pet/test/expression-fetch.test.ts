/** Owner-triggered downloads use the Host transport, with bounded resources. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchExpressionSource, EXPRESSION_URL_TIMEOUT_MS } from '../src/host/expression-fetch.js'
import { MAX_EXPRESSION_SOURCE_BYTES } from '../src/wire.js'

const LOTTIE = JSON.stringify({ v: '5.7.0', w: 10, h: 10, layers: [{ ty: 4 }] })

function mockFetch(response: () => Promise<Response> = async () => new Response(LOTTIE)) {
  const fetch = vi.fn((_url: unknown, _init?: RequestInit) => response())
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Host-network URL import', () => {
  it('uses Host fetch for local, reserved and custom-port targets without an opt-in', async () => {
    const fetch = mockFetch()
    for (const url of [
      'https://localhost/a.json',
      'https://assets.internal:8443/a.json',
      'https://198.18.0.7/a.json',
      'https://10.0.0.7/a.json',
      'https://[::1]/a.json',
    ]) {
      await expect(fetchExpressionSource(url)).resolves.toBe(LOTTIE)
      expect(fetch).toHaveBeenLastCalledWith(new URL(url), expect.objectContaining({
        method: 'GET', redirect: 'manual', credentials: 'omit', signal: expect.any(AbortSignal),
      }))
      const options = fetch.mock.calls.at(-1)?.[1] as RequestInit & Record<string, unknown>
      expect(options).not.toHaveProperty('dispatcher')
      expect(options).not.toHaveProperty('agent')
      expect(options).not.toHaveProperty('lookup')
      const headers = new Headers(options.headers)
      expect(headers.has('authorization')).toBe(false)
      expect(headers.has('cookie')).toBe(false)
      expect(headers.has('accept-encoding')).toBe(false)
    }
  })

  it('rejects malformed, non-HTTPS and credential-bearing URLs before fetching', async () => {
    const fetch = mockFetch()
    for (const url of ['not a url', 'https://', 'file:///tmp/a.json', 'http://cdn.example/a', 'https://user:pass@cdn.example/a']) {
      await expect(fetchExpressionSource(url)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('follows three redirects including internal targets and cancels their bodies', async () => {
    const cancelled = vi.fn()
    const fetch = mockFetch()
    for (const location of ['/next', 'https://assets.internal:8443/a', '/final']) {
      fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), {
        status: 302, headers: { location },
      }))
    }
    await expect(fetchExpressionSource('https://cdn.example/start')).resolves.toBe(LOTTIE)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(cancelled).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.at(-1)?.[0]).toEqual(new URL('https://assets.internal:8443/final'))
    const signals = fetch.mock.calls.map(call => (call[1] as RequestInit).signal)
    expect(new Set(signals).size).toBe(1)
  })

  it('rejects excess or missing redirects and unsupported redirect URLs', async () => {
    const fetch = mockFetch(async () => new Response(null, { status: 302, headers: { location: '/again' } }))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toMatchObject({ code: 'EXPRESSION_FETCH_FAILED' })
    expect(fetch).toHaveBeenCalledTimes(4)
    fetch.mockResolvedValueOnce(new Response(null, { status: 302 }))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('重定向缺少')
    for (const location of ['https://[', 'http://example.com/a', 'https://user:pass@example.com/a', 'file:///tmp/a']) {
      fetch.mockClear()
      fetch.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location } }))
      await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves content validation to Lottie regardless of the MIME label', async () => {
    mockFetch(async () => new Response(LOTTIE, { headers: { 'content-type': 'text/html' } }))
    await expect(fetchExpressionSource('https://cdn.example/a')).resolves.toBe(LOTTIE)
  })

  it('reports HTTP failures and cancels unread bodies', async () => {
    const cancelled = vi.fn()
    mockFetch(async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 404 }))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('HTTP 404')
    expect(cancelled).toHaveBeenCalledOnce()
  })

  it('caps declared and streamed sizes and accepts exactly the limit', async () => {
    const fetch = mockFetch()
    const cancelled = vi.fn()
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-length': String(MAX_EXPRESSION_SOURCE_BYTES + 1) },
    }))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('上限')
    expect(cancelled).toHaveBeenCalledOnce()
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_EXPRESSION_SOURCE_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel: cancelled,
    })))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('上限')
    expect(cancelled).toHaveBeenCalledTimes(2)
    fetch.mockResolvedValueOnce(new Response('x'.repeat(MAX_EXPRESSION_SOURCE_BYTES)))
    await expect(fetchExpressionSource('https://cdn.example/a')).resolves.toHaveLength(MAX_EXPRESSION_SOURCE_BYTES)
  })

  it('reports empty and broken bodies without leaking request URLs', async () => {
    const fetch = mockFetch(async () => new Response(null))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toMatchObject({ code: 'EXPRESSION_FETCH_FAILED' })
    fetch.mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.error(new Error('sensitive-url-and-query')) },
    })))
    const failed = await fetchExpressionSource('https://cdn.example/a?token=redacted').catch(error => error)
    expect(failed.code).toBe('EXPRESSION_FETCH_FAILED')
    expect(failed.message).not.toContain('sensitive-url')
    expect(failed.message).not.toContain('redacted')
    fetch.mockRejectedValueOnce(new Error('https://cdn.example/a?token=redacted'))
    await expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('请求失败')
  })

  it('aborts a request waiting for headers at the overall deadline', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    const outcome = expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(EXPRESSION_URL_TIMEOUT_MS)
    await outcome
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps the same deadline through redirects and a stalled body', async () => {
    vi.useFakeTimers()
    let bodySignal: AbortSignal | null | undefined
    const fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
      if (fetch.mock.calls.length === 1) {
        await new Promise(resolve => setTimeout(resolve, 6000))
        return new Response(null, { status: 302, headers: { location: '/final' } })
      }
      bodySignal = init.signal
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
          init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason), { once: true })
        },
      }))
    })
    vi.stubGlobal('fetch', fetch)
    const outcome = expect(fetchExpressionSource('https://cdn.example/a')).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(EXPRESSION_URL_TIMEOUT_MS - 1)
    expect(bodySignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await outcome
    expect(bodySignal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
