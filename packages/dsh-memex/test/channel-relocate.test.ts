import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MEMEX_CHANNEL, MEMEX_REMOTE_ENDPOINT, type MemexRemoteResult } from '../src/contract.js'
import { registerMemexChannel } from '../src/host/channel.js'
import type { KernelResult, KernelRunOptions } from '../src/run/types.js'

// Configuring a remote can also replace the library directory. The host copies
// the library, runs the kernel in the new directory, and only deletes the old one
// once the configuration resolves there — the page persists the home in between.

type Handler = (endpoint: string, params?: unknown, signal?: AbortSignal) => Promise<{ ok: boolean; value?: unknown; error?: { message: string } }>

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'dsh-memex-relocate-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function harness(currentHome: () => string) {
  const calls: Array<{ args: readonly string[]; home: string }> = []
  let handler: Handler | undefined
  const resolution = () => ({
    scope: 'acme',
    home: currentHome(),
    homeSource: 'configured',
    publish: 'internal',
    publishKnown: true,
    source: 'config',
    entries: ['acme'],
    access: { read: ['acme'], write: ['acme'] },
    memory: true,
    fallback: true,
    personal: { read: true, write: true },
    claim: { kind: 'path', prefix: '/work/acme' },
    workspacePaths: ['/work/acme'],
    offBy: { memory: [], fallback: [] },
  })
  const runner = async (args: readonly string[], options: KernelRunOptions): Promise<KernelResult> => {
    calls.push({ args, home: options.home })
    return { ok: true, exitCode: 0, stdout: 'synced\n', stderr: '' }
  }
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
      resolve: () => resolution() as never,
      list: () => [resolution() as never],
      resolveByName: () => resolution() as never,
      bindingFor: () => undefined,
      accessFor: () => ({ read: ['acme'], write: ['acme'] }) as never,
    } as never,
    config: () => ({ autoDerive: true, scopes: [{ name: 'acme', pathPrefixes: ['/work/acme'] }], bindings: [] }),
    runner,
    installedVersion: () => '0.4.1',
    namespaceDir: root,
    homeDir: root,
  })
  return {
    calls,
    remote: async (params: unknown) => {
      if (handler === undefined) throw new Error('channel was not registered')
      const answer = await handler(MEMEX_REMOTE_ENDPOINT, params, new AbortController().signal)
      return answer as { ok: boolean; value?: MemexRemoteResult; error?: { message: string } }
    },
  }
}

describe('remote endpoint with a new library directory', () => {
  it('moves the library and runs the kernel in the new directory, keeping the old one', async () => {
    const from = join(root, 'acme')
    const to = join(root, 'moved')
    mkdirSync(join(from, 'cards'), { recursive: true })
    writeFileSync(join(from, 'cards', 'note.md'), 'note body')
    writeFileSync(join(from, '.sync.json'), '{}')
    const h = harness(() => from)

    const answer = await h.remote({ scope: 'acme', action: 'init', url: 'git@example:me/acme.git', home: to })

    expect(answer.ok).toBe(true)
    expect(answer.value?.status).toBe('ok')
    expect(answer.value?.moved).toEqual({ from, to })
    expect(readFileSync(join(to, 'cards', 'note.md'), 'utf8')).toBe('note body')
    expect(existsSync(join(to, '.sync.json'))).toBe(true)
    expect(h.calls).toEqual([{ args: ['sync', '--init', 'git@example:me/acme.git'], home: to }])
    // The old directory survives until the page persists the new home.
    expect(existsSync(from)).toBe(true)
  })

  it('pulls instead of initializing when no URL is given and a remote already exists', async () => {
    const from = join(root, 'acme')
    const to = join(root, 'moved')
    mkdirSync(join(from, 'cards'), { recursive: true })
    writeFileSync(join(from, '.sync.json'), '{"remote":"git@example:me/acme.git"}')
    const h = harness(() => from)

    await h.remote({ scope: 'acme', action: 'sync', home: to })

    expect(h.calls).toEqual([{ args: ['sync'], home: to }])
  })

  it('refuses to delete the old directory while the configuration still points at it', async () => {
    const from = join(root, 'acme')
    const to = join(root, 'moved')
    mkdirSync(join(from, 'cards'), { recursive: true })
    writeFileSync(join(from, 'cards', 'note.md'), 'note body')
    const stillOld = harness(() => from)

    await stillOld.remote({ scope: 'acme', action: 'init', url: 'git@example:me/acme.git', home: to })
    const refused = await stillOld.remote({ scope: 'acme', action: 'retire' })

    expect(refused.ok).toBe(false)
    expect(refused.error?.message).toMatch(/no library resolves/)
    expect(existsSync(from)).toBe(true)
  })

  it('deletes the old directory once the configuration resolves to the new one', async () => {
    const from = join(root, 'acme')
    const to = join(root, 'moved')
    mkdirSync(join(from, 'cards'), { recursive: true })
    writeFileSync(join(from, 'cards', 'note.md'), 'note body')
    let current = from
    const h = harness(() => current)

    await h.remote({ scope: 'acme', action: 'init', url: 'git@example:me/acme.git', home: to })
    current = to // the page persisted the new home
    const retired = await h.remote({ scope: 'acme', action: 'retire' })

    expect(retired.ok).toBe(true)
    expect(existsSync(from)).toBe(false)
    expect(existsSync(join(to, 'cards', 'note.md'))).toBe(true)
    // A second retire is not silently repeated.
    const again = await h.remote({ scope: 'acme', action: 'retire' })
    expect(again.ok).toBe(false)
  })

  it('deletes the old directory after a move that also renaming the library', async () => {
    const from = join(root, 'acme')
    const to = join(root, 'renamed')
    mkdirSync(join(from, 'cards'), { recursive: true })
    writeFileSync(join(from, 'cards', 'note.md'), 'note body')
    let current = from
    const h = harness(() => current)

    await h.remote({ scope: 'acme', action: 'init', url: 'git@example:me/acme.git', home: to })
    current = to // the page persisted the *renamed* entry pointing at the new home
    const retired = await h.remote({ scope: 'acme', action: 'retire' })

    expect(retired.ok).toBe(true)
    expect(existsSync(from)).toBe(false)
  })

  it('refuses a target that is the same directory', async () => {
    const from = join(root, 'acme')
    mkdirSync(join(from, 'cards'), { recursive: true })
    const h = harness(() => from)
    const answer = await h.remote({ scope: 'acme', action: 'init', url: 'git@example:me/acme.git', home: from })
    expect(answer.ok).toBe(false)
    expect(answer.error?.message).toMatch(/already lives/)
  })
})
