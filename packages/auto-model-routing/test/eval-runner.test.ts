import { afterEach, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fakeJev, json, tier } from './fake-jev.js'
import { buildState } from '../src/context.js'
import { userInput } from '../src/input.js'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'eval/run.mjs')
type Case = { id: string; exp: string[]; text: string; prev?: string; prevUser?: string; prevAssistant?: string }
const cases: Case[] = JSON.parse(readFileSync(resolve(root, 'eval/cases.json'), 'utf8'))
const baseline: { knownMisses: string[] } = JSON.parse(readFileSync(resolve(root, 'eval/baseline.json'), 'utf8'))
let close: (() => Promise<void>) | undefined
afterEach(async () => { await close?.(); close = undefined })

function run(base: string): Promise<{ code: number | null; out: string }> {
 return new Promise(done => {
  const child = spawn(process.execPath, [script, '--base', base, '--runs', '1'], { cwd: root, env: { ...process.env, OPENROUTER_API_KEY: 'sk-or-test' } })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk }); child.stderr.on('data', chunk => { out += chunk })
  child.on('close', code => done({ code, out }))
 })
}
const hostState = (c: Case) => buildState({ previous: c.prev as never, prevUser: c.prevUser, prevAssistant: c.prevAssistant, text: userInput([{ source: { kind: 'user' }, content: [{ type: 'text', text: c.text }] }]).text })
const byState = new Map(cases.map(c => [hostState(c), c]))
// Each case is identified by the exact state the Host would send: a state the runner built differently has no case.
const caseOf = (state: string) => { const c = byState.get(state); if (!c) throw new Error(`unexpected state: ${state.slice(0, 80)}`); return c }
// A tier outside `exp` for known misses, inside `exp` for everything else.
const ALL = ['simple', 'standard', 'complex', 'escalated']
const baselineAnswer = (c: Case) => baseline.knownMisses.includes(c.id) ? ALL.find(t => !c.exp.includes(t))! : c.exp[0]!

it('runner_exit_codes_and_shared_state', async () => {
 // run.mjs imports the built package: compile it first so the test never runs against a stale lib/.
 execFileSync(process.execPath, [createRequire(import.meta.url).resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: root })
 const server = await fakeJev((req, res, body) => tier(baselineAnswer(caseOf(JSON.parse(body).state)))(req, res, body))
 close = server.close
 const ok = await run(server.base)
 expect(ok.code, ok.out).toBe(0)
 expect(server.bodies).toHaveLength(cases.length)
 // The runner builds exactly the state the Host builds for the same turn (every body maps back to its case).
 expect(new Set((server.bodies as { state: string }[]).map(b => caseOf(b.state).id)).size).toBe(cases.length)
 // One new miss outside the baseline: regression.
 const victim = cases.find(c => !baseline.knownMisses.includes(c.id))!
 server.set((req, res, body) => { const c = caseOf(JSON.parse(body).state); tier(c.id === victim.id ? ALL.find(t => !c.exp.includes(t))! : baselineAnswer(c))(req, res, body) })
 const regressed = await run(server.base)
 expect(regressed.code, regressed.out).toBe(1)
 expect(regressed.out).toContain(victim.id)
 // A failed request: exit 2 and not counted as a miss.
 server.set((req, res, body) => { const c = caseOf(JSON.parse(body).state); (c.id === victim.id ? json(500, {}) : tier(baselineAnswer(c)))(req, res, body) })
 const failed = await run(server.base)
 expect(failed.code, failed.out).toBe(2)
 expect(failed.out).not.toMatch(new RegExp(`miss[^\\n]*${victim.id}`))
}, 60_000)
