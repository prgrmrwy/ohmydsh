import { afterAll, beforeAll, expect, it } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// eval/live.mjs is a manual paid script; here it runs against a preloaded fetch stub only.
const pkg = resolve(import.meta.dirname, '..')
let work: string
const STUB = `
import { appendFileSync } from 'node:fs'
const log = process.env.STUB_LOG
globalThis.fetch = async (url, init = {}) => {
  appendFileSync(log, JSON.stringify({ url: String(url), body: init.body ?? null }) + '\\n')
  if (String(url).includes('/models/')) return Response.json({ data: { endpoints: [{ pricing: { prompt: '0.00000004', completion: '0' } }] } })
  const body = JSON.parse(init.body)
  const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { choice: Object.keys(q.criteria)[0] }]))
  return Response.json({ model: 'stub', answers, usage: { cost: 0 } })
}
`
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'amr-eval-'))
  for (const entry of readdirSync(pkg)) if (!['lib', 'node_modules'].includes(entry)) cpSync(join(pkg, entry), join(work, entry), { recursive: true })
  const modules = dirname(dirname(createRequire(join(pkg, 'package.json')).resolve('typescript/package.json')))
  symlinkSync(modules, join(work, 'node_modules'), 'dir')
  execFileSync('npm', ['run', 'build'], { cwd: work, stdio: 'pipe', env: { ...process.env, npm_config_offline: 'true' } })
  mkdirSync(join(work, 'stub'), { recursive: true })
  writeFileSync(join(work, 'stub/fetch.mjs'), STUB)
}, 120_000)
afterAll(() => { rmSync(work, { recursive: true, force: true }) })

const runLive = (args: string[]) => {
  const out = join(work, `out-${Math.random()}.json`), log = join(work, `log-${Math.random()}.jsonl`)
  writeFileSync(log, '')
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(join(work, 'stub/fetch.mjs')).href, join(work, 'eval/live.mjs'), ...args, out], { cwd: work, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: 'stub-key', STUB_LOG: log } })
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { url: string; body: string | null })
  return { status: r.status, stderr: r.stderr, out, calls }
}

it('spec Scenario "未知预设提前拒绝"', () => {
  const r = runLive(['--preset', 'does-not-exist'])
  expect(r.status).not.toBe(0)
  expect(r.calls).toHaveLength(0)
  expect(existsSync(r.out)).toBe(false)
})

it('spec Scenario "报告记录实验条件"', async () => {
  const r = runLive(['--preset', 'effort-as-verification'])
  expect(r.status, r.stderr).toBe(0)
  const report = JSON.parse(readFileSync(r.out, 'utf8'))
  expect(report.preset).toBe('effort-as-verification')
  expect(report.calls).toHaveLength(18)
  expect(report.calls.find((c: { id: string }) => c.id === 'dev-debug').expected.depth).toEqual(['higher'])
  for (const c of report.calls) expect(['main', 'delegated']).toContain(c.execution)
  const { buildState } = await import(pathToFileURL(join(work, 'lib/context.js')).href)
  const cases = JSON.parse(readFileSync(join(work, 'eval/cases.json'), 'utf8')) as { id: string; task: string; execution?: string }[]
  const decisions = r.calls.filter(c => c.url.includes('/decisions'))
  expect(decisions.length).toBeLessThanOrEqual(20)
  decisions.forEach((call, i) => {
    const sent = JSON.parse(call.body!) as { state: unknown }
    expect(typeof sent.state).toBe('string')
    expect(sent.state).toBe(buildState({ text: cases[i]!.task, execution: cases[i]!.execution ?? 'delegated' }))
  })
  for (const key of ['version', 'policyVersion', 'mappingVersion', 'rubricVersion', 'pluginVersion', 'schema']) expect(readFileSync(r.out, 'utf8')).not.toContain(`"${key}"`)
}, 60_000)
