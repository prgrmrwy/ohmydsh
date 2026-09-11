/** Focused tests for strict unified-locus management route contracts. */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { PetChangeFeed } from '../src/host/changes.js'
import { PetLifecycleMachine } from '../src/host/lifecycle.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import {
  LocusManagementError,
  type LocusManagementPort,
} from '../src/host/locus/management.js'
import { createPetRoutes } from '../src/host/routes.js'
import { LOCUS_ROUTES } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

interface Route {
  readonly path: string
  readonly handler: (req: never, res: never) => void | Promise<void>
}

interface Reply {
  readonly status: number
  readonly body: {
    readonly ok: boolean
    readonly data?: Record<string, unknown>
    readonly error?: string
    readonly message?: string
  }
}

let harness: PetHarness | undefined

async function makeRoutes(locus?: LocusManagementPort): Promise<readonly Route[]> {
  harness = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-locus-routes-'))
  const paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)
  const lifecycle = new PetLifecycleMachine()
  lifecycle.markReady()
  return createPetRoutes({
    repository: harness.repository,
    capabilities: new CapabilityRegistry(),
    coordinator: {} as never,
    lifecycle,
    paths,
    packageVersion: '0.1.0',
    changes: new PetChangeFeed(),
    archiveSink: async () => {},
    locusIdentity: () => ({ actorId: 'owner' }),
    ...(locus === undefined ? {} : { locus }),
  } as never) as readonly Route[]
}

async function call(
  routes: readonly Route[],
  routePath: string,
  body: unknown,
): Promise<Reply> {
  const route = routes.find(item => item.path === routePath)
  if (route === undefined) throw new Error(`route ${routePath} is not registered`)
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:3080' },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
    },
    destroy: vi.fn(),
  }
  let status = 0
  let payload: Reply['body'] | undefined
  const res = {
    writeHead(code: number) {
      status = code
      return this
    },
    end(text: string) {
      payload = JSON.parse(text) as Reply['body']
    },
  }
  await route.handler(req as never, res as never)
  if (payload === undefined) throw new Error('route did not write a response')
  return { status, body: payload }
}

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('unified locus route parsing', () => {
  it('rejects a discovery request with multiple selectors before calling the port', async () => {
    const discovery = vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] }))
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery,
    })

    const reply = await call(routes, LOCUS_ROUTES.discovery, {
      parentSessionId: 'main-1',
      childSessionId: 'child-1',
    })

    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ ok: false, error: 'INVALID_REQUEST' })
    expect(discovery).not.toHaveBeenCalled()
  })

  it('rejects unknown endpoint fields and malformed action fields strictly', async () => {
    const bind = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const scope = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
      bind,
      scope,
    })

    const unknownEndpoint = await call(routes, LOCUS_ROUTES.bind, {
      action: 'bind',
      endpoint: { chatId: 'oc-project', displayName: 'Project' },
      parentSessionId: 'main-1',
    })
    expect(unknownEndpoint.status).toBe(400)
    expect(unknownEndpoint.body.error).toBe('INVALID_REQUEST')

    const invalidScope = await call(routes, LOCUS_ROUTES.scope, {
      action: 'scope',
      locusId: 'locus-1',
      mode: 'admin',
    })
    expect(invalidScope.status).toBe(400)
    expect(invalidScope.body.error).toBe('INVALID_REQUEST')
    expect(bind).not.toHaveBeenCalled()
    expect(scope).not.toHaveBeenCalled()
  })

  it('rejects unknown fields independently for archive and stop actions', async () => {
    const archive = vi.fn(async () => ({ action: 'archive', locus: {} } as never))
    const stop = vi.fn(async () => ({ action: 'stop', locus: {} } as never))
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
      archive,
      stop,
    })
    const archiveReply = await call(routes, LOCUS_ROUTES.archive, {
      action: 'archive', locusId: 'locus-1', expectedGeneration: 1, unexpected: true,
    })
    const stopReply = await call(routes, LOCUS_ROUTES.stop, {
      action: 'stop', locusId: 'locus-1', expectedGeneration: 1, unexpected: true,
    })
    expect(archiveReply.status).toBe(400)
    expect(stopReply.status).toBe(400)
    expect(archiveReply.body.error).toBe('INVALID_REQUEST')
    expect(stopReply.body.error).toBe('INVALID_REQUEST')
    expect(archive).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('rejects NUL endpoint identifiers before invoking a management action', async () => {
    const bind = vi.fn(async () => ({ action: 'bind', locus: {} } as never))
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
      bind,
    })
    const reply = await call(routes, LOCUS_ROUTES.bind, {
      action: 'bind', endpoint: { chatId: 'oc-project\u0000evil' }, parentSessionId: 'main-1',
    })
    expect(reply.status).toBe(400)
    expect(reply.body.error).toBe('INVALID_REQUEST')
    expect(bind).not.toHaveBeenCalled()
  })

  it.each([
    [LOCUS_ROUTES.unbind, 'unbind'],
    [LOCUS_ROUTES.archive, 'archive'],
    [LOCUS_ROUTES.stop, 'stop'],
  ] as const)('requires endpoint proof for exact-current %s', async (path, action) => {
    const handler = vi.fn(async () => ({ action, locus: {} } as never))
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
      ...(action === 'unbind' ? { unbind: handler } : action === 'archive' ? { archive: handler } : { stop: handler }),
    })

    const reply = await call(routes, path, { action, locusId: 'locus-1' })
    expect(reply.status).toBe(400)
    expect(reply.body.error).toBe('INVALID_REQUEST')
    expect(handler).not.toHaveBeenCalled()
  })

  it('requires the dedicated route action to match its path', async () => {
    const unbind = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const routes = await makeRoutes({
      view: vi.fn(() => ({ generation: 1, loci: [], defaultQa: [], discovery: { byEndpoint: [], byParent: [], byChild: [] } })),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
      unbind,
    })

    const reply = await call(routes, LOCUS_ROUTES.unbind, {
      action: 'scope',
      locusId: 'locus-1',
      mode: 'read',
    })

    expect(reply.status).toBe(400)
    expect(reply.body.error).toBe('INVALID_REQUEST')
    expect(unbind).not.toHaveBeenCalled()
  })
})

describe('unified locus route error mapping', () => {
  function portWithError(error: LocusManagementError): LocusManagementPort {
    return {
      view: vi.fn(async () => {
        throw error
      }),
      discovery: vi.fn(async () => ({ byEndpoint: [], byParent: [], byChild: [] })),
    }
  }

  it.each([
    ['CAPABILITY_UNAVAILABLE', 'LOCUS_UNAVAILABLE', 503],
    ['ACTION_UNAVAILABLE', 'LOCUS_UNAVAILABLE', 503],
    ['LOCUS_NOT_FOUND', 'LOCUS_NOT_FOUND', 503],
    ['LOCUS_BUSY', 'LOCUS_BUSY', 409],
    ['LOCUS_INVALID', 'LOCUS_INVALID', 400],
    ['LOCUS_STOPPED', 'LOCUS_STOPPED', 409],
    ['REVISION_CONFLICT', 'LOCUS_CONFLICT', 409],
    ['INVALID_REQUEST', 'INVALID_REQUEST', 400],
  ] as const)('maps %s to the stable %s response', async (source, expected, status) => {
    const routes = await makeRoutes(portWithError(new LocusManagementError(source, 'safe diagnostic')))

    const reply = await call(routes, LOCUS_ROUTES.view, {})

    expect(reply.status).toBe(status)
    expect(reply.body).toMatchObject({ ok: false, error: expected })
    expect(reply.body.message).toContain('safe diagnostic')
  })

  it('keeps unavailable management additive and does not consult legacy Pet state', async () => {
    const routes = await makeRoutes()

    const reply = await call(routes, LOCUS_ROUTES.action, {
      action: 'unbind',
      endpoint: { chatId: 'oc-missing' },
      locusId: 'locus-missing',
      expectedGeneration: 1,
      expectedLocusId: 'locus-missing',
      expectedUpdatedAt: 1,
    })

    expect(reply.status).toBe(503)
    expect(reply.body.error).toBe('LOCUS_UNAVAILABLE')
    expect(harness?.repository.listTasks()).toEqual([])
    expect(harness?.repository.listChatBindings()).toEqual([])
  })
})
