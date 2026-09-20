import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { KernelRunner } from '../src/tools/index.js'
import { mapConcurrent, registerMemexTools } from '../src/tools/index.js'
import { TOOL_DESCRIPTIONS } from '../src/tools/descriptions.generated.js'
import type { BindingEntry, ScopeResolution, ScopeService } from '../src/scope/types.js'

/**
 * A route as the resolver would build it: the workspace's entries (this scope
 * alone here) and the reach they imply, so the tool layer reads one source.
 */
function scope(name: string, binding?: BindingEntry, memory = true): ScopeResolution {
  const read = binding === undefined
    ? [name]
    : [...new Set([name, ...binding.read, 'personal'])]
  const write = binding === undefined
    ? (name === 'personal' ? [name] : [name, 'personal'])
    : [...new Set([name, ...binding.write])]
  return {
    scope: name,
    home: `/memex/${name}`,
    publish: name === 'internal' || name === 'current' ? 'internal' : 'external',
    publishKnown: true,
    memory,
    source: 'config',
    created: false,
    workspacePaths: name === 'internal' || name === 'current' ? [`/work/${name}`] : [],
    entries: [name],
    access: { current: name, read, write },
  }
}

function resolver(binding?: BindingEntry): ScopeService {
  const values = new Map(['current', 'alpha', 'beta', 'blocked', 'personal', 'internal'].map(name => [name, scope(name, binding)]))
  return {
    resolve: cwd => {
      expect(cwd).toBe('/workspace/current')
      return values.get('current')!
    },
    list: () => [...values.values()],
    resolveByName: name => {
      const found = values.get(name)
      if (found === undefined) throw new Error(`Unknown scope: ${name}`)
      return found
    },
    ensure: value => value,
    bindingFor: () => binding,
    accessFor: current => binding === undefined
      ? { current, read: [current], write: current === 'personal' ? [current] : [current, 'personal'] }
      : { current, read: binding.read.includes('personal') ? binding.read : [...binding.read, 'personal'], write: binding.write },
  }
}

function capture(runner: KernelRunner, binding?: BindingEntry, concurrency?: number, service: ScopeService = resolver(binding)): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    logger: () => ({ warn: vi.fn() }),
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
  }
  registerMemexTools(ctx as never, service, { runner, ...(concurrency === undefined ? {} : { fanoutConcurrency: concurrency }) })
  return tools
}

const exec = { agent: { session: { header: { cwd: '/workspace/current' } } } }

async function call(tool: ToolDefinition, args: unknown): Promise<Record<string, unknown>> {
  const value = await tool.execute(args, exec as never) as { json: string }
  return JSON.parse(value.json) as Record<string, unknown>
}

function ok(stdout = '', stderr = '') {
  return { ok: true, exitCode: 0, stdout, stderr }
}

describe('memex DSH tool registration', () => {
  it('registers the eight Pi-aligned tools with generated descriptions', () => {
    const tools = capture(async () => ok())
    expect([...tools.keys()]).toEqual(['memex_search', 'memex_read', 'memex_recall', 'memex_write', 'memex_retro', 'memex_links', 'memex_archive', 'memex_organize'])
    for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
      if (tools.has(name)) expect(tools.get(name)!.description.startsWith(description)).toBe(true)
    }
    expect(tools.get('memex_search')!.parameters).toHaveProperty('properties.semantic')
    expect(tools.get('memex_recall')!.description).toContain('semantic=true')
  })

  it('rejects calls without the calling session cwd', async () => {
    const tools = capture(async () => ok())
    await expect(tools.get('memex_read')!.execute({ slug: 'x' }, {} as never)).rejects.toThrow(/session\.header\.cwd/)
  })

  it('searches binding scopes concurrently with a bound and deterministic merge', async () => {
    let active = 0
    let peak = 0
    const completed: string[] = []
    const runner: KernelRunner = vi.fn(async (_args, options) => {
      active += 1
      peak = Math.max(peak, active)
      const name = options.home.split('/').at(-1)!
      await new Promise(resolve => setTimeout(resolve, name === 'alpha' ? 25 : name === 'beta' ? 5 : 15))
      completed.push(name)
      active -= 1
      return ok(`## same\n${name} title\n${name} body\n`)
    })
    const tools = capture(runner, { name: 'bound', read: ['beta', 'current', 'alpha'], write: ['current'] }, 2)
    const result = await call(tools.get('memex_search')!, { query: 'term', scope: 'all', limit: 20 })
    expect(peak).toBe(2)
    expect(completed).not.toEqual(['alpha', 'beta', 'current'])
    expect((result.hits as Array<{ scope: string }>).map(hit => hit.scope)).toEqual(['alpha', 'beta', 'current', 'personal'])
    expect(result.targets).toEqual([
      expect.objectContaining({ scope: 'alpha', home: '/memex/alpha' }),
      expect.objectContaining({ scope: 'beta', home: '/memex/beta' }),
      expect.objectContaining({ scope: 'current', home: '/memex/current' }),
      expect.objectContaining({ scope: 'personal', home: '/memex/personal' }),
    ])
  })

  it('supports an explicit scope list, rejects out-of-binding scopes, and preserves partial results', async () => {
    const runner: KernelRunner = vi.fn(async (_args, options) => options.home.endsWith('/beta')
      ? { ok: false, exitCode: 1, stdout: '', stderr: 'broken' }
      : ok('## alpha-card\nAlpha\nBody\n'))
    const tools = capture(runner, { name: 'bound', read: ['alpha', 'beta'], write: ['current'] })
    const result = await call(tools.get('memex_search')!, { query: 'x', scope: ['beta', 'alpha'] })
    expect((result.hits as Array<{ scope: string }>).map(hit => hit.scope)).toEqual(['alpha'])
    expect(result.failures).toEqual([{ scope: 'beta', error: 'memex search failed in scope beta (exit 1)' }])
    await expect(call(tools.get('memex_search')!, { query: 'x', scope: ['blocked'] })).rejects.toThrow(/not reachable from current scope/)
    await expect(call(tools.get('memex_search')!, { query: 'x', scope: ['all'] })).rejects.toThrow(/use scope: "all" by itself/)
  })

  it('keeps current intrinsically readable even when a binding only lists it as writable', async () => {
    const runner: KernelRunner = vi.fn(async () => ok('## current-card\nCurrent\nBody\n'))
    const tools = capture(runner, { name: 'write-only-current', read: ['alpha'], write: ['current'] })
    const searched = await call(tools.get('memex_search')!, { query: 'x' })
    expect((searched.hits as Array<{ scope: string }>).map(hit => hit.scope)).toEqual(['current'])
    await expect(call(tools.get('memex_read')!, { slug: 'x', scope: 'current' })).resolves.toMatchObject({ target: { scope: 'current' } })
  })

  it('uses four workers by default', async () => {
    let active = 0
    let peak = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const runner: KernelRunner = vi.fn(async (_args, options) => {
      active += 1
      peak = Math.max(peak, active)
      if (peak === 4) release()
      await gate
      active -= 1
      const name = options.home.split('/').at(-1)!
      return ok(`## ${name}\n${name}\nBody\n`)
    })
    const tools = capture(runner, { name: 'many', read: ['current', 'alpha', 'beta', 'blocked', 'personal'], write: ['current'] })
    await call(tools.get('memex_search')!, { query: 'x', scope: 'all', limit: 10 })
    expect(peak).toBe(4)
  })

  it('refuses every tool in a workspace whose memory is switched off', async () => {
    // Full off, not just the injections: a workspace the user declared memory-free
    // must not receive cards through a tool call either.
    const off = { ...scope('current', undefined, false) }
    const service: ScopeService = {
      resolve: () => off,
      list: () => [off],
      resolveByName: () => off,
      ensure: () => { throw new Error('ensure must not run for a disabled workspace') },
      bindingFor: () => undefined,
      accessFor: name => ({ current: name, read: [name], write: [name] }),
    }
    const runner: KernelRunner = vi.fn(async () => ok(''))
    const tools = capture(runner, undefined, undefined, service)
    for (const name of ['memex_search', 'memex_read', 'memex_write', 'memex_links', 'memex_archive', 'memex_organize']) {
      await expect(call(tools.get(name)!, { slug: 'x', content: '---\ntitle: X\n---\nBody\n' }))
        .rejects.toThrow(/Memory is off for this workspace/)
    }
    // Nothing reached the kernel, so no card was written anywhere.
    expect(runner).not.toHaveBeenCalled()
  })

  it('reads a concrete readable scope and reports the route', async () => {
    const runner: KernelRunner = vi.fn(async () => ok('---\ntitle: Alpha\n---\nBody\n'))
    const tools = capture(runner, { name: 'bound', read: ['current', 'alpha'], write: ['current'] })
    const result = await call(tools.get('memex_read')!, { slug: 'same', scope: 'alpha' })
    expect(result.target).toEqual(expect.objectContaining({ scope: 'alpha', home: '/memex/alpha' }))
    expect(result.content).toContain('title: Alpha')
    expect(runner).toHaveBeenCalledWith(['read', '--', 'same'], expect.objectContaining({ home: '/memex/alpha' }))
  })

  it('writes current first and then an allowed additional scope', async () => {
    const runner: KernelRunner = vi.fn(async () => ok())
    const tools = capture(runner, { name: 'bound', read: ['current'], write: ['current', 'alpha'] })
    await call(tools.get('memex_write')!, { slug: 'raw', content: '---\ntitle: Raw\ncreated: 2026-01-01\nsource: test\n---\nBody' })
    await call(tools.get('memex_retro')!, { slug: 'learned', title: 'Learned', body: 'A [[lesson]].', category: 'architecture' })
    expect(runner).toHaveBeenNthCalledWith(1, ['write', '--', 'raw'], expect.objectContaining({ home: '/memex/current', stdin: expect.stringContaining('title: Raw') }))
    expect(runner).toHaveBeenNthCalledWith(2, ['write', '--', 'learned'], expect.objectContaining({ home: '/memex/current', stdin: expect.stringContaining('source: dsh') }))
    const additional = await call(tools.get('memex_write')!, { slug: 'nope', content: 'x', scope: 'alpha' })
    expect(additional.additional).toEqual([expect.objectContaining({ scope: 'alpha', written: true })])
    expect(runner).toHaveBeenCalledTimes(4)
  })

  it('keeps the current write when an additional scope is outside the binding', async () => {
    const runner: KernelRunner = vi.fn(async () => ok())
    const tools = capture(runner, { name: 'bound', read: ['current'], write: ['current'] })
    const result = await call(tools.get('memex_write')!, { slug: 'safe', content: 'safe body', scope: 'blocked' })
    expect(result.written).toBe(true)
    expect(result.additional).toEqual([expect.objectContaining({ scope: 'blocked', written: false, error: expect.stringContaining('not reachable from') })])
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('processes multiple additional targets independently', async () => {
    const runner: KernelRunner = vi.fn(async () => ok())
    const tools = capture(runner, { name: 'bound', read: ['current'], write: ['current', 'alpha', 'beta'] })
    const result = await call(tools.get('memex_write')!, { slug: 'safe', content: 'safe body', scope: ['alpha', 'beta', 'blocked'] })
    expect(result.additional).toEqual([
      expect.objectContaining({ scope: 'alpha', written: true }),
      expect.objectContaining({ scope: 'beta', written: true }),
      expect.objectContaining({ scope: 'blocked', written: false }),
    ])
    expect(runner).toHaveBeenCalledTimes(3)
  })

  it('keeps the current write when an external additional scope is guarded', async () => {
    const runner: KernelRunner = vi.fn(async () => ok())
    const bound = { name: 'bound', read: ['current', 'alpha'], write: ['current', 'alpha'] }
    const tools = capture(runner, bound)
    // The resolver fixture exposes an internal scope named "internal"; that term
    // is denied when writing to an external target such as alpha.
    const result = await call(tools.get('memex_write')!, { slug: 'raw', content: 'mentions internal details', scope: 'alpha' })
    expect(result.additional).toEqual([expect.objectContaining({ scope: 'alpha', written: false })])
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('matches upstream retro hooks and write enrichment when auto-sync is enabled', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-memex-retro-'))
    mkdirSync(join(home, 'cards'))
    writeFileSync(join(home, '.sync.json'), JSON.stringify({ auto: true, remote: 'git@example/repo.git' }))
    const current = { ...scope('current'), home }
    const service: ScopeService = {
      resolve: () => current,
      list: () => [current],
      resolveByName: () => current,
      ensure: value => value,
      bindingFor: () => undefined,
      accessFor: name => ({ current: name, read: [name], write: [name, 'personal'] }),
    }
    const runner: KernelRunner = vi.fn(async () => ok())
    const tools = capture(runner, undefined, undefined, service)
    await call(tools.get('memex_retro')!, { slug: 'learned', title: 'Learned', body: 'Body', category: 'architecture' })
    expect(runner).toHaveBeenNthCalledWith(1, ['sync', 'pull'], expect.objectContaining({ home }))
    expect(runner).toHaveBeenNthCalledWith(2, ['write', '--', 'learned'], expect.objectContaining({ home, stdin: expect.stringContaining('category: "architecture"') }))
    expect(runner).toHaveBeenNthCalledWith(3, ['sync', 'push'], expect.objectContaining({ home }))

    await call(tools.get('memex_write')!, { slug: 'raw', content: '---\ntitle: Raw\ncreated: 2026-01-01\n---\nBody', category: 'devops' })
    expect(runner).toHaveBeenNthCalledWith(4, ['write', '--', 'raw'], expect.objectContaining({ stdin: expect.stringContaining('source: dsh') }))
    expect(runner).toHaveBeenNthCalledWith(5, ['sync', 'push'], expect.objectContaining({ home }))
  })

  it('keeps graph-level tools on current scope', async () => {
    const runner: KernelRunner = vi.fn(async () => ok('done'))
    const tools = capture(runner)
    await call(tools.get('memex_links')!, {})
    await call(tools.get('memex_archive')!, { slug: 'old-card' })
    await call(tools.get('memex_organize')!, {})
    expect(runner).toHaveBeenNthCalledWith(1, ['links'], expect.objectContaining({ home: '/memex/current' }))
    expect(runner).toHaveBeenNthCalledWith(2, ['archive', '--', 'old-card'], expect.objectContaining({ home: '/memex/current' }))
    expect(runner).toHaveBeenNthCalledWith(3, ['organize'], expect.objectContaining({ home: '/memex/current' }))
  })

  it('recall uses only current scope and falls back from a missing index to list', async () => {
    const runner: KernelRunner = vi.fn()
      .mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: '', stderr: 'Card not found: index' })
      .mockResolvedValueOnce(ok('one  One title\n'))
    const tools = capture(runner)
    const result = await call(tools.get('memex_recall')!, {})
    expect(result.mode).toBe('list')
    expect(runner).toHaveBeenNthCalledWith(1, ['read', '--', 'index'], expect.objectContaining({ home: '/memex/current' }))
    expect(runner).toHaveBeenNthCalledWith(2, ['search', '--limit', '10', '--list'], expect.objectContaining({ home: '/memex/current' }))
  })
})

describe('bounded mapper', () => {
  it('keeps result order even when workers complete out of order', async () => {
    const result = await mapConcurrent([30, 5, 15], 2, async value => {
      await new Promise(resolve => setTimeout(resolve, value))
      return value
    })
    expect(result).toEqual([30, 5, 15])
  })
})
