import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScopeResolver } from '../src/scope/resolver.js'
import { telemetryFile } from '../src/telemetry/sink.js'
import { registerMemexTools } from '../src/tools/index.js'

beforeEach(() => { vi.stubEnv('DSH_HOME', mkdtempSync(join(tmpdir(), 'memex-semantic-reject-'))) })
afterEach(() => { vi.unstubAllEnvs() })

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'memex-semantic-library-'))
  const resolver = createScopeResolver({
    homeDir: home, gitRemote: () => undefined, gitRoot: () => undefined,
    config: {
      scopes: [{ name: 'project', pathPrefixes: ['/work/project'] }, { name: 'personal' }],
    },
  })
  const resolve = vi.spyOn(resolver, 'resolve')
  const ensure = vi.spyOn(resolver, 'ensure')
  const resolveByName = vi.spyOn(resolver, 'resolveByName')
  const runner = vi.fn(async (_args: readonly string[], _options: { home: string }) => ({ ok: true, exitCode: 0, stdout: '## card\nCard\nBody\n', stderr: '' }))
  const tools = new Map<string, ToolDefinition>()
  registerMemexTools({ logger: () => ({ warn: vi.fn() }), tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => undefined } } } as never, resolver, { runner })
  const search = (args: unknown) => tools.get('memex_search')!.execute(args, { agent: { session: { header: { cwd: '/work/project' } } } } as never)
  return { home, resolver, resolve, ensure, resolveByName, runner, search }
}

async function rejected(f: ReturnType<typeof fixture>, args: unknown) {
  const outcome = await f.search(args).then(value => value, error => error)
  // Check the behavior first: an accidentally successful search must show that it called the kernel.
  expect(f.runner).not.toHaveBeenCalled()
  expect(outcome).toBeInstanceOf(TypeError)
  expect((outcome as Error).message).toMatch(/语义检索当前未启用/)
  expect((outcome as Error).message).toMatch(/来源|边界/)
  expect(f.resolve).not.toHaveBeenCalled()
  expect(f.ensure).not.toHaveBeenCalled()
  expect(f.resolveByName).not.toHaveBeenCalled()
}

describe('检索后端的来源边界与更换条件', () => {
  it('默认路径不带语义开关', async () => {
    const f = fixture()
    await f.search({ query: 'Card' })
    expect(f.runner).toHaveBeenCalledTimes(1)
    expect(f.runner.mock.calls[0]![0]).not.toContain('--semantic')
  })

  it('语义请求在环境有远端 key 时零调用', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-placeholder')
    const f = fixture()
    const current = f.resolver.resolve('/work/project')
    expect(existsSync(join(current.home, '.memexrc'))).toBe(false)
    f.resolve.mockClear()
    await rejected(f, { query: '中文查询', semantic: true })
  })

  it('多库语义请求整体拒绝', async () => {
    const f = fixture()
    expect(f.resolver.resolve('/work/project').access.read).toContain('personal')
    f.resolve.mockClear()
    await rejected(f, { query: '中文查询', semantic: true, scope: 'all' })
  })

  it('语义请求不写召回遥测', async () => {
    const f = fixture()
    await f.search({ query: 'Card' })
    const file = telemetryFile(new Date())
    const before = { size: statSync(file).size, content: readFileSync(file, 'utf8') }
    f.runner.mockClear()
    f.resolve.mockClear()
    f.ensure.mockClear()
    await f.search({ query: '中文查询', semantic: true }).catch(() => undefined)
    expect(statSync(file).size).toBe(before.size)
    expect(readFileSync(file, 'utf8')).toBe(before.content)
    expect(f.runner).not.toHaveBeenCalled()
  })
})
