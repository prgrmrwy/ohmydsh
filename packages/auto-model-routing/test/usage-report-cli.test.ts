import { beforeAll, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { bindAll, makeHome, user, userTurn, writeSession } from './usage-report-fixture.js'

const root = resolve(import.meta.dirname, '..')
const entry = join(root, 'lib/usage-report.js')
const zodDir = dirname(dirname(createRequire(import.meta.url).resolve('zod/package.json')))
// The CLI runs the built file: compile first so the test never runs against a stale lib/.
beforeAll(() => { execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: root }) }, 120_000)

function snapshot(dir: string): Record<string, string> {
 const out: Record<string, string> = {}
 const walk = (d: string) => { for (const name of readdirSync(d)) { const p = join(d, name); if (statSync(p).isDirectory()) walk(p); else out[p] = readFileSync(p, 'base64') } }
 walk(dir)
 return out
}

it('spec Scenario "损坏数据中的正文与路径不泄漏"', () => {
 const h = makeHome()
 writeSession(h, 'session-secret-1', [...userTurn(1, 'a', 2), user(2, 'user', 'SECRET-TEXT')], { cwd: '/tmp/secret-ws' })
 bindAll(h, 'session-secret-1', 'a', 2, 1)
 appendFileSync(join(h, 'state/auto-model-routing/allocation-feedback.jsonl'), '{"sessionId":"SECRET-TEXT\n')
 writeSession(h, 'session-secret-2', userTurn(1, 'b', 3), { cwd: '/tmp/secret-ws', corruptFrame: 2 })
 bindAll(h, 'session-secret-2', 'b', 3, 2)
 const before = snapshot(h)
 const run = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${h}`, `--allow-fs-read=${root}`, `--allow-fs-read=${zodDir}`, entry], { env: { ...process.env, DSH_HOME: h }, encoding: 'utf8' })
 expect(run.status, run.stderr).toBe(0)
 const out = JSON.parse(run.stdout)
 expect(out.failures['decode-failed']).toBe(1)
 expect(out.failures['parse-failed']).toBe(1)
 for (const text of [run.stdout, run.stderr]) for (const secret of ['SECRET-TEXT', 'secret-ws', 'session-secret']) expect(text).not.toContain(secret)
 expect(snapshot(h)).toEqual(before)
})

it('falls back to ~/.dsh when DSH_HOME is unset', () => {
 const fake = mkdtempSync(join(tmpdir(), 'usage-home-'))
 const h = makeHome(); writeSession(h, 'S1', userTurn(1, 'a', 1)); bindAll(h, 'S1', 'a', 1, 1)
 mkdirSync(fake, { recursive: true }); renameSync(h, join(fake, '.dsh'))
 const env: NodeJS.ProcessEnv = { ...process.env, HOME: fake }; delete env.DSH_HOME
 const out = JSON.parse(execFileSync(process.execPath, [entry], { env, encoding: 'utf8' }))
 expect(out.groups[0].subgroups[0].decisions).toBe(1)
})

it('rejects a malformed --since', () => {
 const run = spawnSync(process.execPath, [entry, '--since', '10/25'], { env: { ...process.env, DSH_HOME: makeHome() }, encoding: 'utf8' })
 expect(run.status).toBe(2)
})

it('has no outbound, spawn or write capability in its source', () => {
 const text = readFileSync(join(root, 'src/usage-report.ts'), 'utf8')
 expect(text).not.toMatch(/node:(https?|net|dns|child_process)|\bfetch\(|\b(writeFile|appendFile|mkdir|rename|unlink|rm|createWriteStream)(Sync)?\b/)
})
