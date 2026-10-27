// Synthetic DSH_HOME for usage-report tests: multi-frame zstd session logs and ledgers. No real data.
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'

export type Event = Record<string, unknown>
export const T0 = Date.UTC(2026, 9, 20, 2, 0, 0) // 2026-10-20 10:00 +08:00
let seq = 0
const at = (minute: number) => T0 + minute * 60_000

export const turn = (n: number, minute = n) => ({ type: 'turn/start', time: at(minute), data: { turn: n } })
export const user = (minute: number, kind = 'user', text = 'hello') => ({ type: 'user/message', time: at(minute), surfaceOp: 'append', data: { content: text, role: 'user', id: `u${++seq}`, source: { kind } } })
export const header = (model: string, effort: string, minute: number, provider = 'codex'): Event => ({ type: 'request/header', time: at(minute), data: { reason: 'change', header: { config: { provider, model, reasoningEffort: effort } } } })
export const call = (id: string, n: number, minute: number, usage: Record<string, number> = { inputTokens: 10, outputTokens: 5 }, surfaceOp: unknown = 'append') =>
  ({ type: 'assistant/message', time: at(minute), ...(surfaceOp === undefined ? {} : { surfaceOp }), data: { turn: n, step: 1, message: { id, role: 'assistant', content: [] }, usage } })

/** A user turn: turn/start + user message + `calls` assistant calls with ids `${prefix}-${i}`. */
export function userTurn(n: number, prefix: string, calls: number, minute = n) {
  const out: Event[] = [turn(n, minute), user(minute)]
  for (let i = 0; i < calls; i++) out.push(call(`${prefix}-${i}`, n, minute))
  return out
}

export function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'usage-report-'))
  mkdirSync(join(home, 'state/auto-model-routing/sessions'), { recursive: true })
  mkdirSync(join(home, 'sessions'), { recursive: true })
  return home
}

export interface SessionOptions { cwd?: string; header?: Event; corruptFrame?: number; truncateTail?: number }
/** Each event is its own zstd frame, after a header frame (as DSH writes). */
export function writeSession(home: string, id: string, events: Event[], options: SessionOptions = {}) {
  const dir = join(home, 'sessions', `--${(options.cwd ?? '/tmp/ws').replaceAll('/', '-')}--`, id)
  mkdirSync(dir, { recursive: true })
  let s = 0
  const lines = [{ type: 'session', version: 4, id, createdAt: T0, cwd: options.cwd ?? '/tmp/ws', isSeeded: false, delegationDepth: 0, ...options.header }, ...events.map(e => ({ seq: ++s, ...e }))]
  const frames = lines.map(line => Buffer.from(zstdCompressSync(Buffer.from(JSON.stringify(line) + '\n'))))
  if (options.corruptFrame !== undefined) { const f = frames[options.corruptFrame]!; for (let i = 6; i < f.length; i++) f[i] = 0xff }
  let bytes = Buffer.concat(frames)
  if (options.truncateTail) bytes = bytes.subarray(0, bytes.length - options.truncateTail)
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), bytes)
}

/** `version: null` omits the historical keys; `strategy` adds the current family key (a snapshot exists if either is present). */
export interface Bind { session: string; message: string; decision: number; model?: string; effort?: string; depth?: string; version?: string | null; mapping?: string; strategy?: string; provider?: string; requestSeq?: number }
export function bind(home: string, b: Bind) {
  const line = {
    sessionId: b.session, messageId: b.message, decisionId: b.decision, depth: b.depth ?? 'baseline', model: b.model ?? 'gpt-6.1-sol', effort: b.effort ?? 'medium',
    ...(b.version === null && !b.strategy ? {} : { snapshot: { decidedAt: T0, appliedAt: T0, ...(b.version === null ? {} : { policyVersion: b.version ?? 'policy-v2-aaaa', mappingVersion: b.mapping ?? 'map-1' }), ...(b.strategy ? { strategy: b.strategy } : {}), decisionProvider: 'openrouter', decisionModel: 'jev', ms: 1, provider: b.provider ?? 'codex', requestSeq: b.requestSeq ?? 1 } }),
    boundAt: T0,
  }
  appendFileSync(join(home, 'state/auto-model-routing/allocation-feedback.jsonl'), JSON.stringify(line) + '\n')
}
export function feedback(home: string, session: string, message: string, decision: number, value: string | null) {
  appendFileSync(join(home, 'state/auto-model-routing/allocation-feedback.jsonl'), JSON.stringify({ type: 'feedback', version: 2, sessionId: session, messageId: message, decisionId: decision, at: T0, feedback: value }) + '\n')
}
export function judge(home: string, session: string, n: number) {
  appendFileSync(join(home, 'state/auto-model-routing/judgements.jsonl'), JSON.stringify({ sessionId: session, turn: n, tier: 'standard', effort: 'medium', model: 'gpt-6.1-sol', rubricVersion: 'r1' }) + '\n')
}
export function mode(home: string, session: string, value: 'AUTO' | 'MANUAL') {
  writeFileSync(join(home, 'state/auto-model-routing/sessions', `${createHash('sha256').update(session).digest('hex')}.json`), JSON.stringify({ mode: value }))
}
/** Bind every call id `${prefix}-${i}` for i < count to one decision. */
export function bindAll(home: string, session: string, prefix: string, count: number, decision: number, extra: Partial<Bind> = {}) {
  for (let i = 0; i < count; i++) bind(home, { session, message: `${prefix}-${i}`, decision, ...extra })
}
