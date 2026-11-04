import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli/eval-retrieval.js'
import { runRetrieval, retrieveQuestion, type RetrievalRunner } from '../src/eval/retrieval/run.js'
import { readFrozenRetrieval } from '../src/eval/retrieval/freeze.js'
import { installedKernelVersion } from '../src/run/kernel.js'
import * as installation from '../src/run/installation.js'
import * as snapshot from '../src/eval/retrieval/snapshot.js'
import { KernelError } from '../src/run/types.js'
import { createScopeResolver } from '../src/scope/resolver.js'
import { registerMemexTools } from '../src/tools/index.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(nested = false) {
  const home = mkdtempSync(join(realpathSync(tmpdir()), 'retrieval-parity-')); roots.push(home)
  vi.stubEnv('DSH_HOME', join(home, 'dsh'))
  const library = join(home, 'library'); mkdirSync(join(library, 'cards', ...(nested ? ['a'] : [])), { recursive: true })
  writeFileSync(join(library, 'cards', ...(nested ? ['a'] : []), 'x.md'), '---\ntitle: Fixture\n---\nunique-fixture-marker\n')
  if (nested) writeFileSync(join(library, '.memexrc'), JSON.stringify({ nestedSlugs: true }))
  const question = { id: 'q', query: 'unique-fixture-marker', targets: [nested ? 'a/x' : 'x'], type: 'single-hop' as const, topic: 'fixture', origin: 'fixture', set: 'dev' as const }
  const goldset = join(home, 'gold.json'); writeFileSync(goldset, JSON.stringify([question]))
  return { home, library, goldset, question }
}
function plugin(library: string, home: string, runner?: RetrievalRunner) {
  const resolver = createScopeResolver({ homeDir: home, config: { autoDerive: false, scopes: [{ name: 'fixture', home: library, pathPrefixes: ['/fixture'] }] }, gitRemote: () => undefined, gitRoot: () => undefined })
  const tools = new Map<string, ToolDefinition>()
  registerMemexTools({ logger: () => ({ warn() {} }), tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => undefined } } } as never, resolver, runner ? { runner } : {})
  return async (query: string, limit = 10) => {
    const result = await tools.get('memex_search')!.execute({ query, limit }, { agent: { session: { header: { cwd: '/fixture' } } } } as never) as { json: string }
    return JSON.parse(result.json) as { hits: { slug: string }[] }
  }
}
const success = { ok: true, exitCode: 0, stdout: '## x\nFixture\nsummary\n', stderr: '' }
function files(root: string): Record<string, { size: number; hash: string }> {
  if (!existsSync(root)) return {}
  const result: Record<string, { size: number; hash: string }> = {}
  function walk(directory: string, prefix = '') {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name); const relative = `${prefix}${name}`; const stat = lstatSync(path)
      if (stat.isDirectory()) walk(path, `${relative}/`)
      else result[relative] = { size: stat.size, hash: createHash('sha256').update(readFileSync(path)).digest('hex') }
    }
  }
  walk(root); return result
}

describe('评测检索与插件关键词路径一致', () => {
  it('评测与插件工具的内核参数一致', async () => {
    const f = fixture(); const toolRunner = vi.fn(async () => success); const evalRunner = vi.fn(async () => success)
    const search = plugin(f.library, f.home, toolRunner)
    for (const query of ['中文检索问题', 'API-name v1.2 /path', '重试 API-name 超时']) for (const limit of [1, 10, 50]) {
      await search(query, limit)
      await retrieveQuestion({ ...f.question, query }, { snapshotRoot: f.library, limit, runner: evalRunner })
    }
    expect(evalRunner.mock.calls.map(args => args[0])).toEqual(toolRunner.mock.calls.map(args => args[0]))
    expect(evalRunner).toHaveBeenCalledTimes(9)
  })

  it('nestedSlugs 库返回带前缀的 slug', async context => {
    if (!installedKernelVersion()) { context.skip('Pinned @touchskyer/memex kernel unavailable; real-kernel parity not verified'); return }
    const f = fixture(true)
    const original = await plugin(f.library, f.home)(f.question.query)
    const result = await runRetrieval({ ...f, set: 'dev' })
    expect(result.frozen.observations[0].slugs).toEqual(original.hits.map(hit => hit.slug))
    expect(result.frozen.observations[0].slugs).toContain('a/x')
  })

  it('未知后端被拒绝', async () => {
    const f = fixture(); const runner = vi.fn(async () => success); const output: string[] = []
    const code = await main(['--backend', 'local-semantic', '--library', f.library, '--goldset', f.goldset, '--set', 'dev'], { home: f.home, runner, stderr: text => output.push(text) })
    expect(code).not.toBe(0)
    expect(output.join('')).toContain('lexical')
    expect(runner).not.toHaveBeenCalled()
    expect(existsSync(join(f.home, '.dsh-memex-eval'))).toBe(false)
    const help: string[] = []
    expect(await main(['--help'], { stdout: text => help.push(text) })).toBe(0)
    expect(help.join('')).toContain('--recompute')
    for (const args of [['--output', join(f.home, 'elsewhere')], ['--set', 'triple']]) expect(await main(args, { home: f.home, stderr() {} })).not.toBe(0)
    expect(existsSync(join(f.home, '.dsh-memex-eval'))).toBe(false)
  })

  it('评测不写遥测', async () => {
    const f = fixture(); await plugin(f.library, f.home, async () => success)(f.question.query)
    const telemetry = join(f.home, 'dsh', 'plugins', 'dsh-memex'); const before = files(telemetry)
    expect(Object.keys(before).length).toBeGreaterThan(0)
    const runner = vi.fn(async () => success); const logs: string[] = []
    expect(await main(['--library', f.library, '--goldset', f.goldset, '--set', 'dev'], { home: f.home, runner, runId: 'fixture-run', stdout: text => logs.push(text), stderr: text => logs.push(text) })).toBe(0)
    expect(files(telemetry)).toEqual(before)
    const runDir = join(f.home, '.dsh-memex-eval', 'retrieval', 'fixture-run')
    expect(readFrozenRetrieval(runDir).observations).toHaveLength(1)
    expect(runner.mock.calls[0]![1].home).toBe(join(runDir, 'snapshot'))
    expect(logs.join('')).toContain('report')
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(packageJson.bin['dsh-memex-eval-retrieval']).toBe('./lib/cli/eval-retrieval.js')
    expect(packageJson.scripts['build:host']).toContain("chmodSync('lib/cli/eval-retrieval.js',0o755)")
  })

  it('运行器将空结果与三种内核错误分别冻结', async () => {
    const f = fixture()
    const empty = await retrieveQuestion(f.question, { snapshotRoot: f.library, runner: async () => ({ ...success, stdout: '' }) })
    expect(empty).toMatchObject({ status: 'empty', slugs: [], returnedChars: 0, error: null })
    const cases: RetrievalRunner[] = [async () => ({ ...success, stdout: 'bad output' }), async () => ({ ...success, ok: false, exitCode: 1 }), async () => { throw new KernelError('timeout', 'fixture timeout') }]
    for (const [index, runner] of cases.entries()) {
      const result = await runRetrieval({ ...f, set: 'dev', runner, runId: `errors-${index}` })
      expect(result.report.status).toBe('incomplete')
      expect(result.frozen.observations[0]).toMatchObject({ status: 'error', slugs: [], returnedChars: 'unknown', error: ['unparseable', 'failed', 'timeout'][index] })
    }
  })

  it('输入错误在输出物化之前拒绝，篡改快照生成 invalid', async () => {
    const f = fixture(); const runner = vi.fn(async () => success)
    for (const extra of [{ set: undefined }, { set: 'holdout' }, { set: 'dev', expectedHash: 'a'.repeat(64) }] as const) {
      await expect(runRetrieval({ ...f, ...extra, runner })).rejects.toThrow()
      expect(existsSync(join(f.home, '.dsh-memex-eval'))).toBe(false)
    }
    writeFileSync(f.goldset, JSON.stringify([{ ...f.question, targets: ['missing'] }]))
    await expect(runRetrieval({ ...f, set: 'dev', runner })).rejects.toThrow(/missing/)
    expect(existsSync(join(f.home, '.dsh-memex-eval'))).toBe(false)
    expect(runner).not.toHaveBeenCalled()
    writeFileSync(f.goldset, JSON.stringify([f.question]))
    const result = await runRetrieval({ ...f, set: 'dev', runner: async (_args, options) => { writeFileSync(join(options.home, 'cards', 'new.md'), 'changed'); return success } })
    expect(result.report.status).toBe('invalid')
    expect(result.report.overall.top1).toBe('unknown')
  })

  it('npm bin 符号链接启动会执行 CLI', () => {
    const f = fixture(); const output = join(f.home, 'compiled')
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
    execFileSync(process.execPath, [tsc, '-p', fileURLToPath(new URL('../tsconfig.json', import.meta.url)), '--outDir', output], { encoding: 'utf8', timeout: 30000 })
    writeFileSync(join(output, 'package.json'), '{"type":"module"}')
    const cli = join(output, 'cli', 'eval-retrieval.js'); chmodSync(cli, 0o755)
    const bin = join(f.home, 'dsh-memex-eval-retrieval'); symlinkSync(cli, bin)
    const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8', timeout: 10000 })
    expect(help).toContain('Usage:')
    expect(help).toContain('--library')
  }, 30000)

  it('冻结实际内核版本与受控替身身份', async context => {
    const f = fixture()
    const mocked = await runRetrieval({ ...f, set: 'dev', runner: async () => success })
    expect(mocked.frozen.kernelVersion).toBe('unknown')
    if (!installedKernelVersion()) { context.skip('Pinned kernel unavailable; actual installation identity not verified'); return }
    const actual = installation.resolveMemexInstallation()
    vi.spyOn(installation, 'resolveMemexInstallation').mockReturnValue({ ...actual, version: 'fixture-observed-version' })
    const result = await runRetrieval({ ...f, set: 'dev' })
    expect(result.frozen.kernelVersion).toBe('fixture-observed-version')
  })

  it('运行前完整性已失败时不执行检索', async () => {
    const f = fixture(); const runner = vi.fn(async () => success)
    vi.spyOn(snapshot, 'verifySnapshot').mockReturnValue({ valid: false, differences: ['cards/x.md'] })
    const result = await runRetrieval({ ...f, set: 'dev', runner })
    expect(runner).not.toHaveBeenCalled()
    expect(result.report.status).toBe('invalid')
    expect(result.report.overall.count).toBe(1)
    expect(result.report.overall.top1).toBe('unknown')
  })

  it('干扰卡与未选集合目标同名时在物化前拒绝', async () => {
    const f = fixture(); const runner = vi.fn(async () => success)
    writeFileSync(f.goldset, JSON.stringify([f.question, { ...f.question, id: 'holdout-q', targets: ['holdout-target'], topic: 'holdout-topic', set: 'holdout' }]))
    await expect(runRetrieval({ ...f, set: 'dev', runner, distractors: [{ slug: 'holdout-target', content: 'fixture distractor' }] })).rejects.toThrow(/conflict/)
    expect(runner).not.toHaveBeenCalled()
    expect(existsSync(join(f.home, '.dsh-memex-eval'))).toBe(false)
  })

  it('重算只接受固定根内安全目录且输出新文件', async () => {
    const f = fixture(); const runner = vi.fn(async () => success); const errors: string[] = []
    const result = await runRetrieval({ ...f, set: 'dev', runner })
    rmSync(join(result.runDir, 'snapshot'), { recursive: true })
    runner.mockClear()
    expect(await main(['--recompute', result.runDir], { home: f.home, runner, stdout() {}, stderr: text => errors.push(text) })).toBe(0)
    expect(runner).not.toHaveBeenCalled()
    expect(readdirSync(join(result.runDir, 'report')).filter(name => name.includes('recomputed')).length).toBe(2)
    const outside = join(f.home, 'outside'); mkdirSync(outside)
    writeFileSync(join(outside, 'frozen.json'), readFileSync(join(result.runDir, 'frozen.json')))
    expect(await main(['--recompute', outside], { home: f.home, stderr() {} })).not.toBe(0)
    expect(readdirSync(outside)).toEqual(['frozen.json'])
    if (process.platform !== 'win32') {
      const unsafe = join(f.home, '.dsh-memex-eval', 'retrieval', 'unsafe'); mkdirSync(unsafe)
      writeFileSync(join(unsafe, 'frozen.json'), readFileSync(join(result.runDir, 'frozen.json')))
      symlinkSync(outside, join(unsafe, 'report'), 'dir')
      expect(await main(['--recompute', unsafe], { home: f.home, stderr() {} })).not.toBe(0)
      expect(readdirSync(outside)).toEqual(['frozen.json'])
    }
  })
})
