/**
 * The `browse` endpoint: what the Host will and will not do for a browse request.
 *
 * Two invariants carry the weight here. The endpoint answers with a PORT and
 * never a URL — only the browser knows whether that port must be translated
 * for another machine. And every refusal is decided BEFORE a process is
 * spawned, so a library that is not allowed to be browsed never gets a live
 * server as a side effect of one click.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MEMEX_BROWSE_ENDPOINT, MEMEX_CHANNEL, type MemexBrowseResult } from '../src/contract.js'
import { registerMemexChannel } from '../src/host/channel.js'
import type { BrowseRegistry } from '../src/run/browse-registry.js'
import type { ScopeResolution } from '../src/scope/types.js'

type Handler = (endpoint: string, params?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>

const roots: string[] = []
afterEach(() => { while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true }) })

function resolution(scope: string, home: string, memory: boolean): ScopeResolution {
  return {
    scope,
    home,
    homeSource: 'namespace',
    publish: 'internal',
    publishKnown: true,
    memory,
    source: 'config',
    created: false,
    workspacePaths: [],
  } as unknown as ScopeResolution
}

function harness(options: {
  memory?: boolean
  materialized?: boolean
  registry?: BrowseRegistry | null
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-memex-browse-'))
  roots.push(root)
  const home = join(root, 'lib')
  if (options.materialized !== false) mkdirSync(join(home, 'cards'), { recursive: true })

  const started: string[] = []
  const registry: BrowseRegistry = options.registry ?? {
    ensure: async (target: string) => {
      started.push(target)
      return { home: target, port: 51234, stop: async () => undefined }
    },
    stopAll: async () => undefined,
    running: () => [],
  }

  let handler: Handler | undefined
  const ctx = {
    get: () => undefined,
    inject(_services: string[], callback: (child: unknown) => void) {
      callback({
        get: () => ({ rpc: { handle(channel: string, next: Handler) { expect(channel).toBe(MEMEX_CHANNEL); handler = next; return () => undefined } } }),
        effect: (run: () => () => void) => run(),
      })
    },
  }

  registerMemexChannel(ctx as never, {
    scopes: {
      resolve: () => resolution('lib', home, options.memory !== false),
      list: () => [],
      resolveByName: (scope: string) => resolution(scope, home, options.memory !== false),
      bindingFor: () => ({ scopes: [] }) as never,
      accessFor: () => ({ readable: [], writable: [] }) as never,
    },
    ...(options.registry === null ? {} : { browse: registry }),
    config: () => ({ autoDerive: true, scopes: [], bindings: [] }),
    installedVersion: () => '0.4.1',
    namespaceDir: root,
    homeDir: '/home/u',
  })

  const call = async (params: unknown) => {
    if (handler === undefined) throw new Error('channel was not registered')
    return await handler(MEMEX_BROWSE_ENDPOINT, params)
  }

  return {
    started,
    call,
    browse: async (scope = 'lib'): Promise<MemexBrowseResult> => (await call({ scope })).value as MemexBrowseResult,
  }
}

describe('browse endpoint', () => {
  it('answers with the bound port, not an address', async () => {
    const h = harness()
    const result = await h.browse()
    expect(result).toEqual({ status: 'ok', port: 51234, scope: 'lib' })
    // Nothing that looks like a URL: assembling one is the browser's job, since
    // only it knows whether the port needs translating for another machine.
    expect(JSON.stringify(result)).not.toMatch(/https?:\/\//)
  })

  it('refuses a memory-off library before starting anything', async () => {
    const h = harness({ memory: false })
    const result = await h.browse()
    expect(result).toMatchObject({ status: 'refused', reason: 'memory-off' })
    expect(result.status === 'refused' && result.message).toMatch(/Settings/)
    // The whole point of ordering the check first: a workspace that
    // deliberately has no memory must not get a live server from one click.
    expect(h.started).toEqual([])
  })

  it('refuses a library that has not been materialized, without starting anything', async () => {
    const h = harness({ materialized: false })
    const result = await h.browse()
    expect(result).toMatchObject({ status: 'refused', reason: 'not-materialized' })
    expect(h.started).toEqual([])
  })

  it('refuses when browsing is not composed at all', async () => {
    const h = harness({ registry: null })
    const result = await h.browse()
    expect(result).toMatchObject({ status: 'refused', reason: 'kernel-unavailable' })
  })

  it('classifies a missing kernel apart from a failed start', async () => {
    const missing = harness({
      registry: {
        ensure: async () => { throw new Error('memex CLI not found in PATH. Install @touchskyer/memex.') },
        stopAll: async () => undefined,
        running: () => [],
      },
    })
    expect(await missing.browse()).toMatchObject({ status: 'refused', reason: 'kernel-unavailable' })

    const broken = harness({
      registry: {
        ensure: async () => { throw new Error('memex serve exited before reporting a listening address: boom') },
        stopAll: async () => undefined,
        running: () => [],
      },
    })
    const result = await broken.browse()
    expect(result).toMatchObject({ status: 'refused', reason: 'start-failed' })
    // The kernel's own words survive, so a failure stays diagnosable.
    expect(result.status === 'refused' && result.message).toMatch(/listening address/)
  })

  it('reports a malformed request as a channel error, not as a refusal', async () => {
    // The channel converts a thrown error into ok:false; keeping malformed
    // input on that path (rather than inventing a refusal reason) means the
    // refusal vocabulary stays reserved for real, explainable library states.
    const h = harness()
    const missing = await h.call({ scope: '' })
    expect(missing.ok).toBe(false)
    expect(missing.error?.message).toMatch(/requires a scope/)
    expect((await h.call(undefined)).ok).toBe(false)
    expect(h.started).toEqual([])
  })
})
