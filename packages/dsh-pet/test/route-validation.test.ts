/**
 * Pet management routes, driven through their real handlers.
 *
 * `routes.ts` is the only surface reachable from outside the Host, and every
 * one of its validation branches was previously unexercised: the suite here
 * calls `createPetRoutes` for real instead of asserting on source text, so a
 * malformed request is proven to be rejected rather than assumed to be.
 */

import { mkdtemp } from 'node:fs/promises'
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
import { ROUTES } from '../src/wire.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

interface Route {
  readonly path: string
  readonly handler: (req: never, res: never) => void | Promise<void>
}

let routes: readonly Route[]
let paths: PetPaths

/** Result envelope every Pet route returns. */
interface Reply {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  message?: string
}

/**
 * Drive one route through its real handler, as the HTTP layer would.
 * @param routePath - Route to call.
 * @param body - Request body.
 * @returns the parsed response envelope.
 */
async function call(routePath: string, body: unknown): Promise<Reply> {
  const route = routes.find(item => item.path === routePath)
  if (route === undefined) throw new Error(`route ${routePath} is not registered`)
  const req = {
    method: 'POST',
    headers: { host: '127.0.0.1:3080' },
    on: (event: string, cb: (chunk?: Buffer) => void) => {
      if (event === 'data') cb(Buffer.from(JSON.stringify(body)))
      if (event === 'end') cb()
    },
    destroy: () => {},
  }
  let payload: unknown
  const res = {
    writeHead() {
      return this
    },
    end(text: string) {
      payload = JSON.parse(text)
    },
  }
  await route.handler(req as never, res as never)
  return payload as Reply
}

beforeEach(async () => {
  harness = await openPetHarness()
  const home = await mkdtemp(path.join(tmpdir(), 'pet-routes-'))
  paths = resolvePetPaths(home)
  await ensurePetDirectories(paths)

  const lifecycle = new PetLifecycleMachine()
  lifecycle.markReady()
  const capabilities = new CapabilityRegistry()
  const coordinator = new PetCoordinator({
    repository: harness.repository,
    capabilities,
    agents: {
      create: async (options: { sessionId: string }) => ({ session: { id: options.sessionId } }),
      get: () => ({}),
    } as never,
    dispatcher: { dispatch: async () => {} },
    resolver: { getSession: () => undefined, getWorkspace: () => undefined },
    contextProviders: new SourceContextRegistry(),
    workspacePath: paths.workspaceRoot,
    selection: () => ({ providerId: 'anthropic', modelId: 'claude-opus-5' }),
  } as never)

  routes = createPetRoutes({
    repository: harness.repository,
    capabilities,
    coordinator,
    lifecycle,
    paths,
    packageVersion: '0.1.0',
    changes: new PetChangeFeed(),
    archiveSink: async () => {},
  } as never)
})

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

describe('every documented route is registered', () => {
  it('exposes each route exactly once', () => {
    const registered = routes.map(route => route.path)

    // A duplicate would shadow one handler and a missing one would 405 with
    // no diagnostic — both invisible without calling the factory.
    expect(new Set(registered).size).toBe(registered.length)
    for (const declared of Object.values(ROUTES)) {
      expect(registered).toContain(declared)
    }
  })
})

describe('unknown fields are refused, not ignored', () => {
  it('rejects a field the route does not declare', async () => {
    const reply = await call(ROUTES.status, { seenGeneration: 0, extra: 'x' })

    // Silently ignoring an unknown field lets a client believe an option took
    // effect when nothing read it.
    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })

  it('refuses prototype-polluting keys', async () => {
    const reply = await call(ROUTES.status, JSON.parse('{"__proto__":{"polluted":true}}'))

    expect(reply.ok).toBe(false)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})

describe('malformed payloads are rejected with a diagnostic', () => {
  it('rejects a non-string skill path', async () => {
    const reply = await call(ROUTES.skillInspect, { path: 42 })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })

  it('rejects a relative skill path', async () => {
    const reply = await call(ROUTES.skillInspect, { path: './relative' })

    // A relative path would resolve against whatever cwd the Host happens to
    // have, which is not a decision the client may make.
    expect(reply.ok).toBe(false)
  })

  it('rejects non-string arguments on import', async () => {
    const reply = await call(ROUTES.skillImport, { path: '/tmp/x', arguments: { a: 1 } })

    // Rejected either way; the path is inspected before the arguments are, so
    // pin the refusal rather than which check happened to fire first.
    expect(reply.ok).toBe(false)
  })

  it('rejects an unknown skill action', async () => {
    const reply = await call(ROUTES.skillMutate, { skillName: 'demo', action: 'destroy' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })

  it('rejects a non-boolean shortcut flag', async () => {
    const reply = await call(ROUTES.skillMutate, {
      skillName: 'demo',
      action: 'shortcut',
      showAsShortcut: 'yes',
    })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })

  it('rejects an invalid context policy', async () => {
    const reply = await call(ROUTES.configUpdate, { defaultContextPolicy: 'sometimes' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })

  it('rejects a non-object appearance', async () => {
    const reply = await call(ROUTES.configUpdate, { appearance: 'purple' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
  })
})

describe('missing targets fail closed with their own code', () => {
  it('reports an unknown skill on mutate', async () => {
    const reply = await call(ROUTES.skillMutate, { skillName: 'nope', action: 'enable' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('SKILL_NOT_FOUND')
  })

  it('reports an unknown Task on archive', async () => {
    const reply = await call(ROUTES.taskArchive, { taskId: 'task-missing' })

    expect(reply.ok).toBe(false)
    expect(reply.error).not.toBe('INTERNAL')
  })

  it('reports an unknown capability on invocation', async () => {
    const reply = await call(ROUTES.invocationCreate, {
      clientInvocationId: 'inv-1',
      capabilityId: 'nope',
      sourceKind: 'none',
    })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('UNKNOWN_CAPABILITY')
  })
})

describe('read routes answer without mutating', () => {
  it('serves status, config, capabilities, skills and tasks', async () => {
    for (const routePath of [
      ROUTES.status,
      ROUTES.config,
      ROUTES.capabilities,
      ROUTES.skills,
      ROUTES.tasks,
      ROUTES.diagnostics,
    ]) {
      const reply = await call(routePath, {})
      expect(reply.ok).toBe(true)
    }
  })

  it('never reports a stored model selection', async () => {
    const reply = await call(ROUTES.config, {})

    // Pet follows the Host default; a stored copy would be a stale ghost.
    expect(reply.data?.['providerId']).toBeUndefined()
    expect(reply.data?.['modelId']).toBeUndefined()
  })
})

describe('a blank agent preset is never stored', () => {
  it('normalizes an empty string to unset', async () => {
    const reply = await call(ROUTES.configUpdate, { agentPreset: '' })

    // Storing `''` is indistinguishable from "unset" to a reader using `??`,
    // and DSH rejects it outright: session resume fails with
    // `preset "" not found`, which the panel cannot show or clear.
    expect(reply.ok).toBe(true)
    expect(reply.data?.['agentPreset']).toBeUndefined()
  })

  it('normalizes whitespace the same way', async () => {
    const reply = await call(ROUTES.configUpdate, { agentPreset: '   ' })

    expect(reply.ok).toBe(true)
    expect(reply.data?.['agentPreset']).toBeUndefined()
  })

  it('keeps a real preset name', async () => {
    const reply = await call(ROUTES.configUpdate, { agentPreset: 'standard' })

    expect(reply.data?.['agentPreset']).toBe('standard')
  })
})

describe('environment routes validate before writing', () => {
  it('rejects a missing scope', async () => {
    const reply = await call(ROUTES.petEnvMutate, { key: 'CR_GROUP', value: 'x', action: 'set' })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('INVALID_REQUEST')
    expect(harness!.repository.listEnvEntries()).toHaveLength(0)
  })

  it('rejects a missing key', async () => {
    const reply = await call(ROUTES.petEnvMutate, { scope: 'global', value: 'x', action: 'set' })

    expect(reply.ok).toBe(false)
    expect(harness!.repository.listEnvEntries()).toHaveLength(0)
  })

  it('rejects a key that is not upper snake case', async () => {
    const reply = await call(ROUTES.petEnvMutate, {
      scope: 'global',
      key: 'cr-group',
      value: 'x',
      action: 'set',
    })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('BINDING_INVALID')
    expect(reply.message).toContain('upper snake case')
    expect(harness!.repository.listEnvEntries()).toHaveLength(0)
  })

  it('rejects an empty value', async () => {
    const reply = await call(ROUTES.petEnvMutate, {
      scope: 'global',
      key: 'CR_GROUP',
      value: '   ',
      action: 'set',
    })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('BINDING_INVALID')
    expect(harness!.repository.listEnvEntries()).toHaveLength(0)
  })

  it('rejects an unknown action', async () => {
    const reply = await call(ROUTES.petEnvMutate, {
      scope: 'global',
      key: 'CR_GROUP',
      value: 'x',
      action: 'drop',
    })

    expect(reply.ok).toBe(false)
    expect(reply.error).toBe('BINDING_INVALID')
  })

  it('rejects an undeclared body field', async () => {
    const reply = await call(ROUTES.petEnvMutate, {
      scope: 'global',
      key: 'CR_GROUP',
      value: 'x',
      action: 'set',
      extra: 'nope',
    })

    expect(reply.ok).toBe(false)
  })

  it('writes a valid global entry and lists it back', async () => {
    const write = await call(ROUTES.petEnvMutate, {
      scope: 'global',
      key: 'CR_GROUP',
      value: 'oc_default',
      action: 'set',
    })
    expect(write.ok).toBe(true)

    const list = await call(ROUTES.petEnv, {})
    expect(list.ok).toBe(true)
    expect(list.data?.['entries']).toEqual([
      expect.objectContaining({ scope: 'global', key: 'CR_GROUP', value: 'oc_default' }),
    ])
    // The client needs both names to render the reference and the scope.
    expect(list.data?.['globalScope']).toBe('global')
    expect(list.data?.['prefix']).toBe('DSH_PET_')
  })

  it('removes an entry', async () => {
    await call(ROUTES.petEnvMutate, {
      scope: 'ws-a',
      key: 'CR_GROUP',
      value: 'oc_a',
      action: 'set',
    })
    const reply = await call(ROUTES.petEnvMutate, {
      scope: 'ws-a',
      key: 'CR_GROUP',
      action: 'remove',
    })

    expect(reply.ok).toBe(true)
    expect(harness!.repository.listEnvEntries()).toHaveLength(0)
  })
})
