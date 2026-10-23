/**
 * Mascot expression routes, driven through their real handlers.
 *
 * These tests exist for the boundary between the Web client and the file
 * store: the request-body limit (which is deliberately different for the
 * import route), the raw-string contract (the response redactor must not
 * rewrite animation JSON), and the fail-closed behaviour when validation
 * rejects an import.
 */

import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { PetChangeFeed } from '../src/host/changes.js'
import { PetCoordinator } from '../src/host/coordinator.js'
import { PetLifecycleMachine } from '../src/host/lifecycle.js'
import { ensurePetDirectories, resolvePetPaths, type PetPaths } from '../src/host/paths.js'
import { createPetRoutes } from '../src/host/routes.js'
import { SourceContextRegistry } from '../src/host/capture.js'
import { EXPRESSION_ROUTES, ROUTES } from '../src/wire.js'
import { PetError } from '../src/host/errors.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined
let routes: readonly Route[]
let paths: PetPaths

interface Route {
  readonly path: string
  readonly handler: (req: never, res: never) => void | Promise<void>
}

/** Result envelope every Pet route returns. */
interface Reply {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
  status?: number
}

/**
 * Drive one route through its real handler.
 * @param routePath - Route to call.
 * @param body - Request body.
 * @param host - Host header, for the trust-boundary case.
 * @returns the parsed response envelope plus the status written by the route.
 */
async function call(
  routePath: string,
  body: unknown,
  host: string = '127.0.0.1:3080',
): Promise<Reply> {
  const route = routes.find(item => item.path === routePath)
  if (route === undefined) throw new Error(`route ${routePath} is not registered`)
  const payloadText = JSON.stringify(body)
  let status: number | undefined
  const req = {
    method: 'POST',
    headers: { host },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from(payloadText))
      if (event === 'end') cb()
    },
    destroy: () => {},
  }
  let payload: unknown
  const res = {
    writeHead(code: number) {
      status = code
      return this
    },
    end(text: string) {
      payload = JSON.parse(text)
    },
  }
  await route.handler(req as never, res as never)
  return { ...(payload as Reply), status }
}

/** Minimal valid Lottie source. */
function source(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: '5.7.0',
    w: 100,
    h: 100,
    layers: [{ ty: 4, shapes: [] }],
    ...overrides,
  })
}

/**
 * Build the real route set, with optional dependency overrides.
 *
 * Rebuilt inside a test when a case needs an injected downloader; the module
 * level `harness`/`paths` are the same ones the default set used.
 */
function buildRoutes(overrides: Record<string, unknown>): readonly Route[] {
  return createPetRoutes({
    repository: harness!.repository,
    capabilities: overrides['capabilities'],
    coordinator: overrides['coordinator'],
    lifecycle: overrides['lifecycle'],
    paths,
    packageVersion: '0.1.0',
    changes: new PetChangeFeed(),
    archiveSink: async () => {},
    ...overrides,
  } as never)
}

/** A lifecycle already marked ready, for re-built route sets. */
function readyLifecycle(): PetLifecycleMachine {
  const lifecycle = new PetLifecycleMachine()
  lifecycle.markReady()
  return lifecycle
}

beforeEach(async () => {
  harness = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-expression-routes-'))
  paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)

  const lifecycle = new PetLifecycleMachine()
  lifecycle.markReady()
  const capabilities = new CapabilityRegistry()
  const coordinator = new PetCoordinator({
    repository: harness.repository,
    capabilities,
    agents: {
      create: async (options: { sessionId: string }) => ({
        agent: { id: options.sessionId },
        dispose: async () => {},
      }),
      get: () => ({ id: 'expression-route-test' }),
    } as never,
    dispatcher: { dispatch: async () => {} },
    resolver: { getSession: () => undefined, getWorkspace: () => undefined },
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  } as never)

  routes = buildRoutes({ capabilities, coordinator, lifecycle })
})

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('expression route contract', () => {
  it('registers every declared expression route exactly once', () => {
    const registered = routes.map(route => route.path)
    expect(new Set(registered).size).toBe(registered.length)
    for (const declared of Object.values(EXPRESSION_ROUTES)) {
      expect(registered).toContain(declared)
    }
  })

  it('reads none before any import', async () => {
    const reply = await call(EXPRESSION_ROUTES.view, {})
    expect(reply.ok).toBe(true)
    expect(reply.data).toEqual({ state: 'none' })
  })

  it('imports and reads the source back as a verbatim string', async () => {
    const text = `\n${source({ token: 'keep-me', secret: 'keep-me-too' })}\n`
    const imported = await call(EXPRESSION_ROUTES.import, { content: text })
    expect(imported.ok).toBe(true)
    expect(imported.data).toMatchObject({ state: 'ok' })

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.ok).toBe(true)
    expect(read.data).toMatchObject({ state: 'ok', content: text })
  })

  it('exports the stored source verbatim', async () => {
    const text = source()
    await call(EXPRESSION_ROUTES.import, { content: text })
    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toMatchObject({ state: 'ok', content: text })
  })

  it('keeps the current expression when validation fails', async () => {
    const current = source()
    await call(EXPRESSION_ROUTES.import, { content: current })

    for (const content of ['{}', '{"v":"5.0.0","w":1,"h":1,"layers":[]}', '{"v":"5.0.0","layers":[{}]}']) {
      const reply = await call(EXPRESSION_ROUTES.import, { content })
      expect(reply.ok).toBe(false)
      expect(reply.error).toBe('INVALID_EXPRESSION')
      expect(reply.status).toBe(400)
    }

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toMatchObject({ state: 'ok', content: current })
  })

  it('distinguishes a non-string body field from an unusable string', async () => {
    const missing = await call(EXPRESSION_ROUTES.import, { content: 42 })
    expect(missing).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })

    const blank = await call(EXPRESSION_ROUTES.import, { content: '   ' })
    expect(blank).toMatchObject({ ok: false, error: 'INVALID_EXPRESSION' })
  })

  it('removes idempotently and reports none afterwards', async () => {
    await call(EXPRESSION_ROUTES.import, { content: source() })
    const first = await call(EXPRESSION_ROUTES.remove, {})
    const second = await call(EXPRESSION_ROUTES.remove, {})
    expect(first).toMatchObject({ ok: true, data: { state: 'none' } })
    expect(second).toMatchObject({ ok: true, data: { state: 'none' } })

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toEqual({ state: 'none' })
  })

  it('writes only inside the expressions directory', async () => {
    await call(EXPRESSION_ROUTES.import, { content: source() })
    // The harness uses a memory medium, so a file-backed database would prove
    // the import had leaked into Pet's durable store.
    await expect(stat(paths.databaseFile)).rejects.toThrow()
    const databaseSibling = await stat(path.join(path.dirname(paths.databaseFile), 'state.sqlite')).catch(
      () => undefined,
    )
    expect(databaseSibling).toBeUndefined()
  })
})

describe('URL import route', () => {
  it('imports a source downloaded by the Host', async () => {
    const text = source()
    routes = buildRoutes({
      capabilities: new CapabilityRegistry(),
      coordinator: undefined,
      lifecycle: readyLifecycle(),
      fetchExpressionSource: async (url: string) => {
        expect(url).toBe('https://cdn.example/thinking.json')
        return text
      },
    } as never)

    const reply = await call(EXPRESSION_ROUTES.importUrl, {
      url: 'https://cdn.example/thinking.json',
    })
    expect(reply).toMatchObject({ ok: true, data: { state: 'ok' } })

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toMatchObject({ state: 'ok', content: text })
  })

  it('rejects a URL that is not https before any download', async () => {
    const reply = await call(EXPRESSION_ROUTES.importUrl, { url: 'http://cdn.example/a.json' })
    expect(reply).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
    expect(reply.status).toBe(400)
  })

  it('maps a failed download to EXPRESSION_FETCH_FAILED', async () => {
    routes = buildRoutes({
      lifecycle: readyLifecycle(),
      fetchExpressionSource: async () => {
        throw new PetError('EXPRESSION_FETCH_FAILED', '下载动画失败：请求失败或超时')
      },
    } as never)

    const reply = await call(EXPRESSION_ROUTES.importUrl, { url: 'https://cdn.example/a.json' })
    expect(reply).toMatchObject({ ok: false, error: 'EXPRESSION_FETCH_FAILED' })
    expect(reply.status).toBe(502)
  })

  it('keeps the current expression when the download fails', async () => {
    const current = source()
    await call(EXPRESSION_ROUTES.import, { content: current })

    routes = buildRoutes({
      lifecycle: readyLifecycle(),
      fetchExpressionSource: async () => {
        throw new PetError('EXPRESSION_FETCH_FAILED', '下载动画失败：请求失败或超时')
      },
    } as never)

    const reply = await call(EXPRESSION_ROUTES.importUrl, { url: 'https://cdn.example/a.json' })
    expect(reply).toMatchObject({ ok: false, error: 'EXPRESSION_FETCH_FAILED' })

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toMatchObject({ state: 'ok', content: current })
  })

  it('keeps the current expression when downloaded content is invalid', async () => {
    const current = source()
    await call(EXPRESSION_ROUTES.import, { content: current })

    routes = buildRoutes({
      lifecycle: readyLifecycle(),
      fetchExpressionSource: async () => '{"v":"5.0.0","w":1,"h":1,"layers":[]}',
    } as never)

    const reply = await call(EXPRESSION_ROUTES.importUrl, { url: 'https://cdn.example/a.json' })
    expect(reply).toMatchObject({ ok: false, error: 'INVALID_EXPRESSION' })

    const read = await call(EXPRESSION_ROUTES.view, {})
    expect(read.data).toMatchObject({ state: 'ok', content: current })
  })
})

describe('request body limits', () => {
  it('accepts the transport limit but rejects the oversized source', async () => {
    // ~600 KiB of valid JSON: above the 512 KiB source cap, far below 4 MiB.
    const filler = 'x'.repeat(600 * 1024)
    const content = source({ chars: [filler] })
    const reply = await call(EXPRESSION_ROUTES.import, { content })
    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_EXPRESSION')
  })

  it('rejects request bodies over 4 MiB with INVALID_REQUEST', async () => {
    const content = source({ filler: 'x'.repeat(5 * 1024 * 1024) })
    const reply = await call(EXPRESSION_ROUTES.import, { content })
    expect(reply).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
  })

  it('keeps the 256 KiB limit for every other route', async () => {
    const reply = await call(ROUTES.status, { seenGeneration: 0, filler: 'x'.repeat(300 * 1024) })
    expect(reply).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
    expect(reply.message).toMatch(/too large/i)
  })
})

describe('trust boundary', () => {
  it('refuses a non-loopback host for the new routes', async () => {
    const reply = await call(EXPRESSION_ROUTES.import, { content: source() }, 'evil.example:3080')
    expect(reply.status).toBe(403)
    expect(reply).toMatchObject({ error: 'INVALID_REQUEST' })
  })
})
