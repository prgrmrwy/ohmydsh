/**
 * The todo disposition route's response shape.
 *
 * Covers the spec scenarios that say an accept returns a one-shot dispatch
 * fact, that settle actions return none, and that the fact is never folded
 * into the todo row (design D9).
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '../src/host/capabilities.js'
import { PetChangeFeed } from '../src/host/changes.js'
import { PetLifecycleMachine } from '../src/host/lifecycle.js'
import { ensurePetDirectories, resolvePetPaths } from '../src/host/paths.js'
import { createPetRoutes } from '../src/host/routes.js'
import { LOCUS_ROUTES } from '../src/wire.js'
import type { PetTodoAction, PetTodoView } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

interface Route {
  readonly path: string
  readonly handler: (req: never, res: never) => void | Promise<void>
}

interface Reply {
  readonly status: number
  readonly body: { readonly ok: boolean; readonly data?: Record<string, unknown>; readonly error?: string }
}

let harness: PetHarness | undefined

function todoView(overrides: Partial<PetTodoView> = {}): PetTodoView {
  return {
    itemId: 'todo-1',
    locusId: 'locus-1',
    generation: 2,
    endpoint: { chatId: 'oc-project' },
    triggerMessageId: 'om_trigger',
    requestedBy: 'ou_requester',
    summary: 'button broken',
    detail: 'trace',
    status: 'open',
    createdAt: 1_000,
    statusChangedAt: 1_000,
    ...overrides,
  } as PetTodoView
}

async function makeRoutes(
  advance: (itemId: string, action: PetTodoAction) => Promise<unknown>,
): Promise<readonly Route[]> {
  harness = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-todo-action-'))
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
    todoLedger: { list: () => [], parents: () => [], advance },
  } as never) as readonly Route[]
}

async function call(routes: readonly Route[], routePath: string, body: unknown): Promise<Reply> {
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
    writeHead(code: number) { status = code; return this },
    end(text: string) { payload = JSON.parse(text) as Reply['body'] },
  }
  await route.handler(req as never, res as never)
  if (payload === undefined) throw new Error('route did not write a response')
  return { status, body: payload }
}

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('todoAction route response (D9)', () => {
  it('todoAction accept returns a dispatch outcome', async () => {
    const routes = await makeRoutes(async () => ({
      todo: todoView({ status: 'accepted' }),
      dispatch: {
        outcome: 'queued',
        executionTarget: { kind: 'session', sessionId: 'main-1' },
      },
    }))
    const reply = await call(routes, LOCUS_ROUTES.todoAction, { itemId: 'todo-1', action: 'accept' })
    expect(reply.body.ok).toBe(true)
    const dispatch = (reply.body.data as { dispatch?: Record<string, unknown> }).dispatch
    expect(dispatch?.['outcome']).toBe('queued')
    // The panel must be able to navigate without re-deriving the target.
    expect(dispatch?.['executionTarget']).toEqual({ kind: 'session', sessionId: 'main-1' })
  })

  it('done and drop return no dispatch field', async () => {
    for (const action of ['done', 'drop'] as const) {
      const routes = await makeRoutes(async () => ({ todo: todoView({ status: 'done' }) }))
      const reply = await call(routes, LOCUS_ROUTES.todoAction, { itemId: 'todo-1', action })
      expect(reply.body.ok).toBe(true)
      expect((reply.body.data as Record<string, unknown>)['dispatch']).toBeUndefined()
      await harness?.close()
      harness = undefined
    }
  })

  it('reread todo carries no dispatch outcome', async () => {
    const routes = await makeRoutes(async () => ({
      todo: todoView({ status: 'accepted' }),
      dispatch: { outcome: 'dispatched', executionTarget: { kind: 'session', sessionId: 'main-1' } },
    }))
    const reply = await call(routes, LOCUS_ROUTES.todoAction, { itemId: 'todo-1', action: 'accept' })
    const todo = (reply.body.data as { todo: Record<string, unknown> }).todo
    // The receipt describes the operation, not the record: nothing about this
    // dispatch may be readable from the row itself (design D6/D7).
    expect(todo['dispatch']).toBeUndefined()
    expect(todo['executionTarget']).toBeUndefined()
    expect(JSON.stringify(todo)).not.toContain('dispatched')
  })

  it('still fails closed when the Host composed no ledger', async () => {
    harness = await openPetHarness()
    const home = await mkdtemp(path.join(tmpdir(), 'pet-todo-action-none-'))
    const paths = resolvePetPaths(home)
    await ensurePetDirectories(paths)
    const lifecycle = new PetLifecycleMachine()
    lifecycle.markReady()
    const routes = createPetRoutes({
      repository: harness.repository,
      capabilities: new CapabilityRegistry(),
      coordinator: {} as never,
      lifecycle,
      paths,
      packageVersion: '0.1.0',
      changes: new PetChangeFeed(),
      archiveSink: async () => {},
      locusIdentity: () => ({ actorId: 'owner' }),
    } as never) as readonly Route[]
    const reply = await call(routes, LOCUS_ROUTES.todoAction, { itemId: 'todo-1', action: 'accept' })
    expect(reply.body.ok).toBe(false)
    expect(reply.body.error).toBe('LOCUS_UNAVAILABLE')
  })
})
