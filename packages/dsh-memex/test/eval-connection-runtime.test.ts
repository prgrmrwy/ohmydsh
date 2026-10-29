import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Readable, Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { expect, it } from 'vitest'
import { registerMemexChannel } from '../src/host/channel.js'
import { createHostEvalDispatch } from '../src/eval/host-plugin.js'

const graph = createRequire(fileURLToPath(new URL('../../dsh-pet/compat/subagent/.launcher/package.json', import.meta.url)))

it('EVAL-032 composition: valid operator cookie cannot bypass Origin/authority; denied requests never reach eval', async () => {
  // Load the same released Connection graph as the managed Host; no live credentials or listener.
  const cordis = await import(/* @vite-ignore */ pathToFileURL(graph.resolve('@deepseek-ai/cordis')).href)
  const connectionPlugin = await import(/* @vite-ignore */ pathToFileURL(graph.resolve('@deepseek-ai/dsh-client-connection')).href)
  const ctx: Context = new cordis.Context()
  const routes = new Map<string, WebRoute>()
  let record: CredentialRecord | undefined
  const credentials = {
    readRecord: async () => record,
    modifyRecord: async (_key: unknown, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      record = await mutate(record); return record
    },
  }
  const calls: string[] = []
  const root = join(tmpdir(), `memex-connection-readonly-${randomUUID()}`)
  const defaultSelection = { provider: 'offline', model: 'daily-control' }
  let defaultReads = 0
  const origin = 'http://127.0.0.1:3080'
  try {
    ctx.provide('credentials', credentials as never)
    ctx.provide('webServer', { register: (route: WebRoute) => {
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    } } as never)
    ctx.provide('agentDefaultModel' as never, { currentSelection: () => { defaultReads++; return defaultSelection } } as never)
    await ctx.plugin(connectionPlugin)
    const fiber = ctx.plugin((child: Context) => {
      const dispatch = createHostEvalDispatch(child, root)
      registerMemexChannel(child, {
        config: () => ({ scopes: [] }),
        scopes: { list: () => [] } as never,
        evalDispatch: async (endpoint, payload, signal) => { calls.push(endpoint); return dispatch(endpoint, payload, signal) },
      })
    })
    await fiber.await()
    await expect.poll(() => routes.has('/dsh-memex')).toBe(true)
    const connection = ctx.get('connection') as HostConnectionHandle
    let loginStatus = 0, cookie = ''
    const launch = new URL(connection.authenticatedUrl(origin))
    expect(connection.authorizeIndex({ method: 'GET', url: launch.pathname + launch.search, headers: { host: launch.host } }, {
      writeHead: (status, headers) => { loginStatus = status; cookie = headers?.['set-cookie']?.split(';', 1)[0] ?? '' }, end: () => {},
    })).toBe(false)
    // Do not put ephemeral credentials into assertion failure output.
    expect(loginStatus).toBe(303)
    expect(Boolean(cookie)).toBe(true)

    const send = async (headers: Record<string, string>, rpcId: string) => {
      const body = JSON.stringify({ type: 'client-request', rpcId, method: 'eval/readDefaultModel', payload: {} })
      const request = Object.assign(Readable.from([Buffer.from(body)]), {
        method: 'POST', url: '/dsh-memex/eval/readDefaultModel',
        headers: { host: launch.host, 'content-type': 'application/json', ...headers },
      }) as IncomingMessage
      let status = 0
      const chunks: Buffer[] = []
      const response = Object.assign(new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } }), {
        writeHead(code: number) { status = code; return this },
      }) as never as ServerResponse
      const route = routes.get('/dsh-memex')!
      await route.handler(request, response)
      return { status, body: Buffer.concat(chunks).toString('utf8') }
    }
    for (const [headers, expected] of [
      [{ origin }, 401],
      [{ cookie, origin: 'https://untrusted.invalid' }, 403],
      [{ cookie, origin: 'null' }, 403],
      [{ cookie, origin, 'sec-fetch-site': 'cross-site' }, 403],
      [{ cookie, host: 'untrusted.invalid:3080', origin: 'http://untrusted.invalid:3080' }, 403],
      [{ cookie, host: 'localhost:3080', origin: 'http://localhost:3080' }, 401],
    ] as const) {
      const denied = await send(headers, 'denied-control')
      expect(denied.status).toBe(expected)
      expect(calls).toEqual([])
      expect(defaultReads).toBe(0)
      expect(existsSync(root)).toBe(false)
    }
    const admitted = await send({ cookie, origin }, 'admitted-control')
    expect(admitted.status).toBe(200)
    expect(JSON.parse(admitted.body)).toMatchObject({ type: 'server-response', rpcId: 'admitted-control', result: { ok: true, value: defaultSelection } })
    expect(calls).toEqual(['eval/readDefaultModel'])
    expect(defaultReads).toBe(1)
    expect(defaultSelection).toEqual({ provider: 'offline', model: 'daily-control' })
    expect(existsSync(root)).toBe(false)
    await fiber.dispose()
    expect(routes.has('/dsh-memex')).toBe(false)
  } finally { await ctx.fiber.dispose() }
})
