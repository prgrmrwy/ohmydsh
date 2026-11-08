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
import { STORAGE_KEY_SEPARATOR } from '../src/host/locus/storage-key.js'
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

const emptyView = { generation: 1, works: [], writeEnabled: false }

function port(overrides: Partial<LocusManagementPort> = {}): LocusManagementPort {
  const refuse = vi.fn(async () => { throw new Error('must not be called') })
  return { view: vi.fn(async () => emptyView), stop: refuse, access: refuse, rebind: refuse, ...overrides }
}

const fence = { expectedLocusId: 'L1', expectedRevision: 5 }

describe('v20 locus-action route parsing', () => {
  it('accepts exactly stop, access and rebind', async () => {
    const routes = await makeRoutes(port())
    for (const action of ['bind', 'unbind', 'archive', 'scope', 'tools', 'confirm-anchor', 'rebuild', 'replace-parent', 'view']) {
      const reply = await call(routes, LOCUS_ROUTES.action, { action, ...fence })
      expect(reply.status, action).toBe(400)
      expect(reply.body.error).toBe('INVALID_REQUEST')
    }
  })

  it('registers no per-action or discovery route', async () => {
    const routes = await makeRoutes(port())
    const paths = routes.map(route => route.path)
    for (const removed of ['/dsh-pet/api/locus-bind', '/dsh-pet/api/locus-unbind', '/dsh-pet/api/locus-archive', '/dsh-pet/api/locus-stop',
      '/dsh-pet/api/locus-scope', '/dsh-pet/api/locus-tools', '/dsh-pet/api/locus-rebuild', '/dsh-pet/api/locus-discovery']) {
      expect(paths).not.toContain(removed)
    }
    expect(paths).toEqual(expect.arrayContaining([LOCUS_ROUTES.view, LOCUS_ROUTES.action, LOCUS_ROUTES.defaultQa, LOCUS_ROUTES.todos]))
  })

  it('refuses the removed fences and a missing revision', async () => {
    const stop = vi.fn(async () => ({ action: 'stop', chat: {} } as never))
    const routes = await makeRoutes(port({ stop }))
    const endpoint = { chatId: 'oc-project' }
    for (const body of [
      { action: 'stop', endpoint, expectedLocusId: 'L1', expectedRevision: 5, expectedGeneration: 1 },
      { action: 'stop', endpoint, expectedLocusId: 'L1', expectedRevision: 5, expectedUpdatedAt: 1 },
      { action: 'stop', endpoint, expectedLocusId: 'L1' },
      { action: 'stop', endpoint, expectedRevision: 5 },
      { action: 'stop', endpoint, locusId: 'L1', ...fence },
    ]) {
      const reply = await call(routes, LOCUS_ROUTES.action, body)
      expect(reply.status).toBe(400)
      expect(reply.body.error).toBe('INVALID_REQUEST')
    }
    expect(stop).not.toHaveBeenCalled()
  })

  it('passes stop, access and rebind through with the trusted actor', async () => {
    const stop = vi.fn(async () => ({ action: 'stop', chat: {} } as never))
    const access = vi.fn(async () => ({ action: 'access', chat: {} } as never))
    const rebind = vi.fn(async () => ({ action: 'rebind', chat: {} } as never))
    const routes = await makeRoutes(port({ stop, access, rebind }))
    await call(routes, LOCUS_ROUTES.action, { action: 'stop', endpoint: { chatId: 'oc-a', threadId: 'omt_1' }, ...fence })
    await call(routes, LOCUS_ROUTES.action, { action: 'access', endpoint: { chatId: 'oc-a' }, accessMode: 'read-only', ...fence })
    await call(routes, LOCUS_ROUTES.action, { action: 'rebind', chatId: 'oc-a', workSessionId: ' S_NEW ', ...fence })
    expect(stop).toHaveBeenCalledWith({ endpoint: { chatId: 'oc-a', threadId: 'omt_1' }, ...fence }, { actorId: 'owner' })
    expect(access).toHaveBeenCalledWith({ endpoint: { chatId: 'oc-a' }, accessMode: 'read-only', ...fence }, { actorId: 'owner' })
    expect(rebind).toHaveBeenCalledWith({ chatId: 'oc-a', workSessionId: 'S_NEW', ...fence }, { actorId: 'owner' })
  })

  it('refuses full access at the parse point while the write switch is off', async () => {
    const access = vi.fn(async () => ({ action: 'access', chat: {} } as never))
    const routes = await makeRoutes(port({ access }))
    const reply = await call(routes, LOCUS_ROUTES.action, { action: 'access', endpoint: { chatId: 'oc-a' }, accessMode: 'danger-full-access', ...fence })
    expect(reply.status).toBe(400)
    expect(access).not.toHaveBeenCalled()
    const bad = await call(routes, LOCUS_ROUTES.action, { action: 'access', endpoint: { chatId: 'oc-a' }, accessMode: 'write', ...fence })
    expect(bad.body.error).toBe('INVALID_REQUEST')
  })

  it('rejects unknown endpoint fields and storage-key separators before invoking the port', async () => {
    const stop = vi.fn(async () => ({ action: 'stop', chat: {} } as never))
    const rebind = vi.fn(async () => ({ action: 'rebind', chat: {} } as never))
    const routes = await makeRoutes(port({ stop, rebind }))
    const unknown = await call(routes, LOCUS_ROUTES.action, { action: 'stop', endpoint: { chatId: 'oc-a', displayName: 'x' }, ...fence })
    const separator = await call(routes, LOCUS_ROUTES.action, { action: 'rebind', chatId: `oc-a${STORAGE_KEY_SEPARATOR}evil`, workSessionId: 'S', ...fence })
    expect(unknown.status).toBe(400)
    expect(separator.status).toBe(400)
    expect(stop).not.toHaveBeenCalled()
    expect(rebind).not.toHaveBeenCalled()
  })
})

describe('v20 locus route error mapping', () => {
  it.each([
    ['CAPABILITY_UNAVAILABLE', 'LOCUS_UNAVAILABLE', 503],
    ['ACTION_UNAVAILABLE', 'LOCUS_UNAVAILABLE', 503],
    ['LOCUS_NOT_FOUND', 'LOCUS_NOT_FOUND', 503],
    ['LOCUS_BUSY', 'LOCUS_BUSY', 409],
    ['REVISION_CONFLICT', 'LOCUS_CONFLICT', 409],
    ['INVALID_REQUEST', 'INVALID_REQUEST', 400],
  ] as const)('maps %s to the stable %s response', async (source, expected, status) => {
    const routes = await makeRoutes(port({ view: vi.fn(async () => { throw new LocusManagementError(source, 'safe diagnostic') }) }))
    const reply = await call(routes, LOCUS_ROUTES.view, {})
    expect(reply.status).toBe(status)
    expect(reply.body).toMatchObject({ ok: false, error: expected })
    expect(reply.body.message).toContain('safe diagnostic')
  })

  it('keeps unavailable management additive and does not consult legacy Pet state', async () => {
    const routes = await makeRoutes()
    const reply = await call(routes, LOCUS_ROUTES.action, { action: 'stop', endpoint: { chatId: 'oc-missing' }, ...fence })
    expect(reply.status).toBe(503)
    expect(reply.body.error).toBe('LOCUS_UNAVAILABLE')
    expect(harness?.repository.listTasks()).toEqual([])
    expect(harness?.repository.listChatBindings()).toEqual([])
  })
})
