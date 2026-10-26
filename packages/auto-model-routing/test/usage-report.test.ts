import { afterEach, beforeEach, expect, it } from 'vitest'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport } from '../src/usage-report.js'
import { bind, bindAll, call, feedback, header, judge, makeHome, mode, turn, user, userTurn, writeSession } from './usage-report-fixture.js'

const tz = process.env.TZ
beforeEach(() => { process.env.TZ = 'Asia/Shanghai' })
afterEach(() => { process.env.TZ = tz })
const group = (r: ReturnType<typeof buildReport>, version: string, model = 'gpt-6.1-sol', depth = 'baseline') =>
  r.groups.find(g => g.version === version)?.subgroups.find(s => s.model === model && s.depth === depth)

it('reads every zstd frame', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 2), call('b-0', 1, 2), call('b-1', 1, 2)])
 bindAll(h, 'S1', 'a', 2, 1); bindAll(h, 'S1', 'b', 2, 1)
 expect(group(buildReport(h), 'policy-v2-aaaa/map-1')!.calls).toBe(4)
})

it('keeps complete frames when only the tail is incomplete', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 6), user(3)], { truncateTail: 5 })
 bindAll(h, 'S1', 'a', 6, 1)
 const r = buildReport(h)
 expect(group(r, 'policy-v2-aaaa/map-1')!.calls).toBe(6)
 expect(r.failures).toMatchObject({ 'tail-incomplete': 1, 'decode-failed': 0 })
})

it('drops a session whose middle frame is corrupt', () => {
 const h = makeHome()
 writeSession(h, 'S1', userTurn(1, 'a', 3), { corruptFrame: 3 })
 bindAll(h, 'S1', 'a', 3, 1)
 const r = buildReport(h)
 expect(r.failures).toMatchObject({ 'decode-failed': 1, 'tail-incomplete': 0 })
 expect(r.groups).toEqual([])
})

it('counts only append calls, once per message id', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 2), call('a-9', 1, 1, {}, { op: 'replace', startSeq: 1, endSeq: 2 }), call('a-0', 1, 1)])
 bindAll(h, 'S1', 'a', 2, 1); bind(h, { session: 'S1', message: 'a-9', decision: 1 })
 expect(group(buildReport(h), 'policy-v2-aaaa/map-1')!.calls).toBe(2)
})

it('excludes child and seeded sessions and states the scope', () => {
 const h = makeHome()
 writeSession(h, 'R', userTurn(1, 'r', 1)); bindAll(h, 'R', 'r', 1, 1)
 writeSession(h, 'C1', userTurn(1, 'c1', 1), { header: { origin: 'subagent' } }); bindAll(h, 'C1', 'c1', 1, 2)
 writeSession(h, 'C2', userTurn(1, 'c2', 1), { header: { origin: 'subagent' } }); bindAll(h, 'C2', 'c2', 1, 3)
 writeSession(h, 'SD', userTurn(1, 'sd', 1), { header: { isSeeded: true } }); bindAll(h, 'SD', 'sd', 1, 4)
 const r = buildReport(h)
 expect(r.excluded).toEqual({ child: 2, seeded: 1 })
 expect(group(r, 'policy-v2-aaaa/map-1')!.decisions).toBe(1)
 expect(r.caveats).toContain('scope-main-session-assistant-calls-only')
})

it('assigns a decision by its first call time and reports the local start', () => {
 const h = makeHome()
 const late = Date.UTC(2026, 9, 24, 15, 50) // 2026-10-24 23:50 +08:00
 const minute = (ms: number) => (ms - Date.UTC(2026, 9, 20, 2, 0)) / 60_000
 writeSession(h, 'S1', [turn(1, minute(late)), user(minute(late)), call('a-0', 1, minute(late)), call('a-1', 1, minute(late) + 20)])
 bindAll(h, 'S1', 'a', 2, 1)
 const r = buildReport(h, { since: '2026-10-25' })
 expect(r.groups).toEqual([])
 expect(r.since).toBe('2026-10-25T00:00:00+08:00')
})

it('links only bound messages and sums decisions across requests', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 31), header('gpt-6.1-sol', 'medium', 2), ...userTurn(2, 'b', 17)])
 bindAll(h, 'S1', 'a', 12, 1)
 for (let i = 0; i < 6; i++) bind(h, { session: 'S1', message: `b-${i}`, decision: 2, requestSeq: 274 })
 for (let i = 6; i < 17; i++) bind(h, { session: 'S1', message: `b-${i}`, decision: 2, requestSeq: 512 })
 bind(h, { session: 'S1', message: 'ghost', decision: 2 })
 const r = buildReport(h)
 const g = group(r, 'policy-v2-aaaa/map-1')!
 expect(g.decisions).toBe(2)
 expect(g.calls).toBe(29)
 expect(g.callsPerDecision).toEqual({ median: 14.5, max: 17 })
 expect(r.coverage.unlinkedBindings).toBe(1)
})

it('puts bindings without a snapshot in an unknown version group', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 2), ...userTurn(2, 'b', 3)])
 bindAll(h, 'S1', 'a', 2, 1, { version: null }); bindAll(h, 'S1', 'b', 3, 2, { version: 'policy-v2-d774ffe6' })
 const r = buildReport(h)
 expect(group(r, 'unknown')!.decisions).toBe(1)
 expect(group(r, 'policy-v2-d774ffe6/map-1')!.decisions).toBe(1)
})

it('reports field presence, uses present calls as the mean denominator, and null for absent fields', () => {
 const h = makeHome()
 const usage = [{ inputTokens: 10, cacheWriteTokens: 4 }, { inputTokens: 20, cacheWriteTokens: 8 }, { inputTokens: 30, cacheWriteTokens: 0 }, { inputTokens: 40 }]
 writeSession(h, 'S1', [turn(1), user(1), ...usage.map((u, i) => call(`a-${i}`, 1, 1, u))])
 bindAll(h, 'S1', 'a', 4, 1)
 const t = group(buildReport(h), 'policy-v2-aaaa/map-1')!.tokens
 expect(t.cacheWriteTokens).toEqual({ sum: 12, mean: 4, present: 3, calls: 4 })
 expect(t.inputTokens).toEqual({ sum: 100, mean: 25, present: 4, calls: 4 })
 expect(t.reasoningTokens).toEqual({ sum: null, mean: null, present: 0, calls: 4 })
})

it('counts user turns without any linked call, including turns without a request header', () => {
 const h = makeHome()
 const events = []
 for (let n = 1; n <= 17; n++) events.push(...userTurn(n, `t${n}`, 2))
 events.push(turn(18), user(18, 'tool-jobs'), call('cont-0', 18, 18)) // continuation of user turn 17
 writeSession(h, 'S1', events)
 for (let n = 1; n <= 10; n++) bindAll(h, 'S1', `t${n}`, 1, n)
 const r = buildReport(h)
 expect(r.coverage).toMatchObject({ userTurns: 17, turnsWithoutRecord: 7 })
})

it('counts sessions currently in AUTO with no record in either ledger', () => {
 const h = makeHome()
 writeSession(h, 'S1', userTurn(1, 'a', 1)); bindAll(h, 'S1', 'a', 1, 1)
 judge(h, 'L1', 1)
 for (const s of ['S1', 'L1', 'S9']) mode(h, s, 'AUTO')
 mode(h, 'S10', 'AUTO'); mode(h, 'S11', 'MANUAL')
 expect(buildReport(h).coverage.autoSessionsWithoutRecord).toBe(2)
})

it('does not treat legacy AUTO turns as the before-AUTO reference', () => {
 const h = makeHome()
 const events = [header('gpt-6.1-sol', 'high', 0)]
 for (let n = 1; n <= 58; n++) events.push(...userTurn(n, `t${n}`, 1))
 writeSession(h, 'S1', events)
 for (let n = 1; n <= 40; n++) judge(h, 'S1', n)
 bindAll(h, 'S1', 't58', 1, 1)
 expect(buildReport(h).referenceBeforeAuto).toEqual([])
})

it('reference lists only call counts and effort distribution', () => {
 const h = makeHome()
 const events = [header('gpt-6.1-sol', 'high', 0)]
 for (let n = 1; n <= 5; n++) events.push(...userTurn(n, `t${n}`, 2))
 events.push(header('gpt-6.1-sol', 'medium', 6))
 events.push(...userTurn(6, 't6', 2))
 writeSession(h, 'S1', events)
 bindAll(h, 'S1', 't6', 2, 1)
 const ref = buildReport(h).referenceBeforeAuto
 expect(ref).toEqual([{ model: 'gpt-6.1-sol', calls: 10, sessions: 1, effort: { high: 10 }, autoEffort: { medium: 2 } }])
 expect(JSON.stringify(ref)).not.toMatch(/Tokens/)
})

it('requires 20 decisions from 3 sessions before a subgroup is observed', () => {
 const h = makeHome()
 const sessions = (count: number, perSession: number, prefix: string) => {
  let d = 0
  for (let s = 0; s < count; s++) {
   const events = []
   for (let n = 1; n <= perSession; n++) events.push(...userTurn(n, `${prefix}${s}-${n}`, 1))
   writeSession(h, `${prefix}${s}`, events)
   for (let n = 1; n <= perSession; n++) bindAll(h, `${prefix}${s}`, `${prefix}${s}-${n}`, 1, ++d + (prefix === 'x' ? 0 : 1000), { model: prefix === 'x' ? 'gpt-6.1-sol' : 'gpt-6-luna' })
  }
 }
 sessions(2, 13, 'x') // 26 decisions, 2 sessions
 sessions(3, 7, 'y') // 21 decisions, 3 sessions
 const r = buildReport(h)
 expect(group(r, 'policy-v2-aaaa/map-1')!.conclusion).toBe('insufficient-sample')
 expect(group(r, 'policy-v2-aaaa/map-1', 'gpt-6-luna')!.conclusion).toBe('observed')
})

it('counts feedback conflicts and treats withdrawn feedback as unrated', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 2), ...userTurn(2, 'b', 1), ...userTurn(3, 'c', 1)])
 bindAll(h, 'S1', 'a', 2, 1); bindAll(h, 'S1', 'b', 1, 2); bindAll(h, 'S1', 'c', 1, 3)
 feedback(h, 'S1', 'a-0', 1, 'appropriate'); feedback(h, 'S1', 'a-1', 1, 'too-high')
 feedback(h, 'S1', 'b-0', 2, 'too-low'); feedback(h, 'S1', 'b-0', 2, null)
 expect(group(buildReport(h), 'policy-v2-aaaa/map-1')!.feedback).toEqual({ appropriate: 0, 'too-high': 0, 'too-low': 0, unknown: 0, conflict: 1, unrated: 2 })
})

it('counts unparsable ledger lines without echoing them', () => {
 const h = makeHome()
 writeSession(h, 'S1', userTurn(1, 'a', 1)); bindAll(h, 'S1', 'a', 1, 1)
 appendFileSync(join(h, 'state/auto-model-routing/allocation-feedback.jsonl'), '{"sessionId":"SECRET-TEXT\n')
 const r = buildReport(h)
 expect(r.failures['parse-failed']).toBe(1)
 expect(JSON.stringify(r)).not.toContain('SECRET-TEXT')
})

it('produces byte-identical output for the same input', () => {
 const h = makeHome()
 writeSession(h, 'S1', [...userTurn(1, 'a', 3), ...userTurn(2, 'b', 2)])
 bindAll(h, 'S1', 'a', 3, 1, { depth: 'lower', effort: 'low' }); bindAll(h, 'S1', 'b', 2, 2)
 expect(JSON.stringify(buildReport(h))).toBe(JSON.stringify(buildReport(h)))
})
