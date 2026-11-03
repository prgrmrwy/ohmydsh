import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEMEX_CHANNEL, MEMEX_DELETE_ENDPOINT, type MemexDeleteResult } from '../src/contract.js'
import { registerMemexChannel } from '../src/host/channel.js'

// Deleting a library is the only irreversible action in this channel. The host
// accepts it only for a *discovered* library — a directory under the namespace
// with cards and no declaring entry — and never for anything the configuration
// knows about or another scope resolves to.

type Handler = (endpoint: string, params?: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-memex-delete-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const resolution = (scope: string, home: string, source: 'discovered' | 'config' | 'derived') => ({
  scope,
  home,
  homeSource: source === 'config' ? 'configured' : 'namespace',
  publish: 'external',
  publishKnown: true,
  source,
  entries: [scope],
  access: { read: [scope], write: [scope] },
  memory: true,
  fallback: true,
  personal: { read: true, write: true },
  claim: { kind: 'none' },
  workspacePaths: [],
  offBy: { memory: [], fallback: [] },
})

function harness(options: { targets: Record<string, ReturnType<typeof resolution>>; declared?: readonly string[]; others?: Array<ReturnType<typeof resolution>> }) {
  let handler: Handler | undefined
  const ctx = {
    get: () => undefined,
    inject(_services: string[], callback: (child: unknown) => void) {
      callback({
        get: () => ({ rpc: { handle(_channel: string, next: Handler) { handler = next; return () => undefined } } }),
        effect: (callback2: () => () => void) => callback2(),
      })
    },
  }
  registerMemexChannel(ctx as never, {
    scopes: {
      resolve: () => { throw new Error('unused') },
      list: () => [...Object.values(options.targets), ...(options.others ?? [])] as never,
      resolveByName: (scope: string) => {
        const found = options.targets[scope]
        if (found === undefined) throw new Error(`Unknown scope: ${scope}`)
        return found as never
      },
      bindingFor: () => undefined,
      accessFor: () => ({ read: [], write: [] }) as never,
    } as never,
    config: () => ({
      autoDerive: true,
      scopes: (options.declared ?? []).map(name => ({ name })),
      bindings: [],
    }),
    installedVersion: () => '0.4.6',
    namespaceDir: root,
    homeDir: root,
  })
  return async (scope: string) => {
    if (handler === undefined) throw new Error('channel was not registered')
    const answer = await handler(MEMEX_DELETE_ENDPOINT, { scope }, new AbortController().signal)
    return answer as { ok: boolean; value?: MemexDeleteResult; error?: { message: string } }
  }
}

function library(name: string, cards: number): string {
  const home = join(root, name)
  mkdirSync(join(home, 'cards'), { recursive: true })
  for (let index = 0; index < cards; index += 1) writeFileSync(join(home, 'cards', `card-${String(index)}.md`), 'x')
  return home
}

describe('delete endpoint', () => {
  it('deletes an undeclared library under the namespace and reports its cards', async () => {
    const home = library('leftover', 3)
    const call = harness({ targets: { leftover: resolution('leftover', home, 'discovered') } })

    const answer = await call('leftover')

    expect(answer.ok).toBe(true)
    expect(answer.value?.status).toBe('ok')
    expect(answer.value?.home).toBe(home)
    expect(answer.value?.cards).toBe(3)
    expect(existsSync(home)).toBe(false)
  })

  it('refuses a library the configuration declares', async () => {
    const home = library('declared-one', 1)
    const call = harness({ targets: { 'declared-one': resolution('declared-one', home, 'config') }, declared: ['declared-one'] })

    const answer = await call('declared-one')

    expect(answer.value?.status).toBe('refused')
    expect(answer.value?.reason).toBe('declared')
    expect(existsSync(home)).toBe(true)
  })

  it('refuses anything that is not a discovered library', async () => {
    const home = library('derived-one', 1)
    const call = harness({ targets: { 'derived-one': resolution('derived-one', home, 'derived') } })

    const answer = await call('derived-one')

    expect(answer.value?.reason).toBe('not-discovered')
    expect(existsSync(home)).toBe(true)
  })

  it('refuses a home that is not the namespace directory for that name', async () => {
    const outside = join(root, 'elsewhere', 'impostor')
    mkdirSync(join(outside, 'cards'), { recursive: true })
    const call = harness({ targets: { impostor: resolution('impostor', outside, 'discovered') } })

    const answer = await call('impostor')

    expect(answer.value?.reason).toBe('outside-namespace')
    expect(existsSync(outside)).toBe(true)
  })

  it('refuses when another scope still resolves to the same directory', async () => {
    const home = library('shared', 1)
    const call = harness({
      targets: { shared: resolution('shared', home, 'discovered') },
      others: [resolution('project', home, 'config')],
    })

    const answer = await call('shared')

    expect(answer.value?.reason).toBe('busy')
    expect(existsSync(home)).toBe(true)
  })
})
