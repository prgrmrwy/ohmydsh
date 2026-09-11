import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import * as ConnectionPlugin from '@deepseek-ai/dsh-client-connection'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import {
  isTrustedRequest,
  optionalString,
  petRoute,
  withBrowserAuth,
  readJsonBody,
  redactSecrets,
  requireString,
  strictBody,
} from '../src/host/http.js'
import { PetError } from '../src/host/errors.js'
import { MAX_REQUEST_BODY_BYTES } from '../src/wire.js'

function request(
  headers: Record<string, string | undefined>,
  body?: string,
  method = 'POST',
): IncomingMessage {
  const emitter = new EventEmitter() as unknown as IncomingMessage & { destroy(): void }
  Object.assign(emitter, { headers, method, destroy: () => {} })
  if (body !== undefined) {
    queueMicrotask(() => {
      emitter.emit('data', Buffer.from(body))
      emitter.emit('end')
    })
  }
  return emitter
}

function response(): ServerResponse & { statusCode?: number; payload?: unknown } {
  const res = {
    writeHead(status: number) {
      ;(this as { statusCode?: number }).statusCode = status
      return this
    },
    end(text: string) {
      let payload: unknown = text
      try {
        payload = JSON.parse(text)
      } catch {
        // Browser-auth rejections intentionally use DSH's minimal text body.
      }
      ;(this as { payload?: unknown }).payload = payload
    },
  }
  return res as unknown as ServerResponse & { statusCode?: number; payload?: unknown }
}

describe('request trust', () => {
  it('accepts loopback hosts', () => {
    expect(isTrustedRequest(request({ host: '127.0.0.1:3080' }))).toBe(true)
    expect(isTrustedRequest(request({ host: 'localhost:3080' }))).toBe(true)
  })

  it('rejects a non-loopback host', () => {
    expect(isTrustedRequest(request({ host: '192.168.1.10:3080' }))).toBe(false)
    expect(isTrustedRequest(request({ host: 'evil.example.com' }))).toBe(false)
  })

  it('rejects a cross-origin page on a loopback host', () => {
    expect(
      isTrustedRequest(request({ host: '127.0.0.1:3080', origin: 'https://evil.example.com' })),
    ).toBe(false)
  })

  it('accepts a matching loopback origin', () => {
    expect(
      isTrustedRequest(request({ host: '127.0.0.1:3080', origin: 'http://localhost:3080' })),
    ).toBe(true)
  })

  it('rejects a malformed origin instead of ignoring it', () => {
    expect(isTrustedRequest(request({ host: '127.0.0.1:3080', origin: ':://bad' }))).toBe(false)
  })

  it('rejects a missing host header', () => {
    expect(isTrustedRequest(request({}))).toBe(false)
  })
})

describe('bounded body parsing', () => {
  it('parses a JSON object', async () => {
    await expect(
      readJsonBody(request({ 'content-length': '9' }, '{"a":1}')),
    ).resolves.toEqual({ a: 1 })
  })

  it('treats an empty body as an empty object', async () => {
    await expect(readJsonBody(request({}, ''))).resolves.toEqual({})
  })

  it('rejects a declared oversize body before reading it', async () => {
    await expect(
      readJsonBody(request({ 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('rejects malformed JSON', async () => {
    await expect(readJsonBody(request({}, '{ nope'))).rejects.toThrow(/valid JSON/)
  })
})

describe('strict field validation', () => {
  it('rejects unknown fields rather than ignoring them', () => {
    expect(() => strictBody({ known: 1, sneaky: 2 }, ['known'])).toThrow(/Unknown request field/)
  })

  it('rejects a non-object body', () => {
    expect(() => strictBody([1, 2], ['a'])).toThrow(/must be a JSON object/)
    expect(() => strictBody('text', ['a'])).toThrow(/must be a JSON object/)
  })

  it('requires non-empty strings and trims identifiers', () => {
    expect(() => requireString({ a: '' }, 'a')).toThrow(/non-empty string/)
    expect(() => requireString({}, 'a')).toThrow(/non-empty string/)
    expect(requireString({ a: '  value  ' }, 'a')).toBe('value')
  })

  it('permits absent optional strings but rejects wrong types', () => {
    expect(optionalString({}, 'a')).toBeUndefined()
    expect(optionalString({ a: '  v  ' }, 'a')).toBe('v')
    expect(optionalString({ a: '   ' }, 'a')).toBeUndefined()
    expect(() => optionalString({ a: 5 }, 'a')).toThrow(/must be a string/)
  })
})

describe('secret redaction', () => {
  it('redacts credential-looking fields at any depth', () => {
    const redacted = redactSecrets({
      providerId: 'anthropic',
      apiKey: 'sk-live-123',
      nested: { authorization: 'Bearer abc', token: 't', safe: 'ok' },
      list: [{ secret: 's' }],
    })

    expect(redacted).toEqual({
      providerId: 'anthropic',
      apiKey: '[redacted]',
      nested: { authorization: '[redacted]', token: '[redacted]', safe: 'ok' },
      list: [{ secret: '[redacted]' }],
    })
  })

  it('leaves ordinary values untouched', () => {
    expect(redactSecrets({ id: 'task-1', count: 2, flag: true })).toEqual({
      id: 'task-1',
      count: 2,
      flag: true,
    })
  })

  it('terminates on a cyclic structure instead of overflowing the stack', () => {
    const cyclic: Record<string, unknown> = { id: 'task-1' }
    cyclic['self'] = cyclic

    // Redaction runs on every successful response, so it must terminate on
    // any input rather than turning a payload bug into a 500.
    expect(redactSecrets(cyclic)).toEqual({ id: 'task-1', self: '[circular]' })
  })

  it('bounds pathologically deep structures', () => {
    let deep: Record<string, unknown> = {}
    const root = deep
    for (let index = 0; index < 5_000; index += 1) {
      const next: Record<string, unknown> = {}
      deep['n'] = next
      deep = next
    }

    expect(() => redactSecrets(root)).not.toThrow()
  })

  it('does not mistake a shared sibling reference for a cycle', () => {
    const shared = { a: 'x' }

    // Only a repeat on the CURRENT path is a cycle; two branches pointing at
    // one object are ordinary data.
    expect(redactSecrets({ one: shared, two: shared })).toEqual({
      one: { a: 'x' },
      two: { a: 'x' },
    })
  })

  it('still redacts secrets nested inside real Pet payloads', () => {
    expect(
      redactSecrets({
        id: 'task-1',
        apiKey: 'sk-live',
        invocations: [{ id: 'inv-1', skillDigest: 'sha256:a' }],
      }),
    ).toEqual({
      id: 'task-1',
      apiKey: '[redacted]',
      invocations: [{ id: 'inv-1', skillDigest: 'sha256:a' }],
    })
  })
})

describe('browser auth fence', () => {
  it('uses pinned Connection auth over real HTTP: no cookie 401, minted cookie 200', async () => {
    const records = new Map<unknown, unknown>()
    const ctx = new Context()
    ctx.provide('credentials', {
      async modifyRecord(key: unknown, mutate: (current: unknown) => Promise<unknown>) {
        const next = await mutate(records.get(key))
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      },
    })
    const webFiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await webFiber
    const connectionFiber = ctx.plugin(ConnectionPlugin)
    await connectionFiber
    ctx.webServer.register({
      kind: 'exact',
      ...withBrowserAuth(
        petRoute('/dsh-pet/api/status', async () => ({ phase: 'ready' })),
        ctx.connection,
      ),
    })
    ctx.webServer.registerFallback((req, res) => {
      if (!ctx.connection.authorizeIndex(req, res)) return
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html>')
    })

    const base = `http://127.0.0.1:${ctx.webServer.port}`
    try {
      const raw = await fetch(`${base}/dsh-pet/api/status`, { method: 'POST', body: '{}' })
      expect(raw.status).toBe(401)
      expect(await raw.text()).toBe('unauthorized')

      const login = await fetch(ctx.connection.authenticatedUrl(base), { redirect: 'manual' })
      expect(login.status).toBe(303)
      const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
      expect(cookie).toMatch(/^dsh-auth-/)

      const gui = await fetch(`${base}/dsh-pet/api/status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: base,
          cookie: cookie!,
        },
        body: '{}',
      })
      expect(gui.status).toBe(200)
      expect(await gui.json()).toEqual({ ok: true, data: { phase: 'ready' } })
    } finally {
      await connectionFiber.dispose()
      await webFiber.dispose()
    }
  })

  it('returns 401 before dispatch for a loopback request without a browser cookie', async () => {
    let dispatched = false
    const route = withBrowserAuth(
      petRoute('/dsh-pet/api/status', async () => {
        dispatched = true
        return { phase: 'ready' }
      }),
      { requestRejection: () => 401 },
    )
    const res = response()

    await route.handler(request({ host: '127.0.0.1:3080' }), res)

    expect(res.statusCode).toBe(401)
    expect(res.payload).toBe('unauthorized')
    expect(dispatched).toBe(false)
  })

  it('lets an authenticated GUI request reach the existing Pet trust and handler', async () => {
    const route = withBrowserAuth(
      petRoute('/dsh-pet/api/status', async () => ({ phase: 'ready' })),
      { requestRejection: () => undefined },
    )
    const res = response()

    await route.handler(
      request({
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        cookie: 'dsh-auth-test=signed-browser-session',
      }, '{}'),
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ ok: true, data: { phase: 'ready' } })
  })

  it('preserves the official 403 verdict before Pet dispatch', async () => {
    let dispatched = false
    const route = withBrowserAuth(
      petRoute('/dsh-pet/api/status', async () => {
        dispatched = true
        return { phase: 'ready' }
      }),
      { requestRejection: () => 403 },
    )
    const res = response()

    await route.handler(request({ host: 'evil.example.com' }), res)

    expect(res.statusCode).toBe(403)
    expect(res.payload).toBe('forbidden')
    expect(dispatched).toBe(false)
  })
})

describe('route wrapper', () => {
  it('fails closed for an untrusted origin', async () => {
    const route = petRoute('/dsh-pet/api/status', async () => ({ phase: 'ready' }))
    const res = response()

    await route.handler(request({ host: 'evil.example.com' }), res)

    expect(res.statusCode).toBe(403)
    expect(res.payload).toMatchObject({ error: 'INVALID_REQUEST' })
  })

  it('returns a successful payload with redaction applied', async () => {
    const route = petRoute('/dsh-pet/api/status', async () => ({
      phase: 'ready',
      providerToken: 'sk-should-not-leak',
    }))
    const res = response()

    await route.handler(request({ host: '127.0.0.1:3080' }, '{}'), res)

    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({
      ok: true,
      data: { phase: 'ready', providerToken: '[redacted]' },
    })
  })

  it('maps a PetError to its stable code and status', async () => {
    const route = petRoute('/dsh-pet/api/tasks', async () => {
      throw new PetError('TASK_NOT_FOUND', 'Pet Task task-9 does not exist')
    })
    const res = response()

    await route.handler(request({ host: '127.0.0.1:3080' }, '{}'), res)

    expect(res.statusCode).toBe(404)
    expect(res.payload).toMatchObject({ ok: false, error: 'TASK_NOT_FOUND' })
  })

  it('collapses an unexpected throw into a bounded INTERNAL error', async () => {
    const route = petRoute('/dsh-pet/api/tasks', async () => {
      throw new Error('x'.repeat(5000))
    })
    const res = response()

    await route.handler(request({ host: '127.0.0.1:3080' }, '{}'), res)

    expect(res.statusCode).toBe(500)
    const payload = res.payload as { error: string; message: string }
    expect(payload.error).toBe('INTERNAL')
    // A stack or huge message never reaches the browser verbatim.
    expect(payload.message.length).toBeLessThanOrEqual(500)
  })

  it('maps a degraded Pet to 503', async () => {
    const route = petRoute('/dsh-pet/api/tasks', async () => {
      throw new PetError('PET_DEGRADED', 'Pet is degraded')
    })
    const res = response()

    await route.handler(request({ host: '127.0.0.1:3080' }, '{}'), res)

    expect(res.statusCode).toBe(503)
  })
})
