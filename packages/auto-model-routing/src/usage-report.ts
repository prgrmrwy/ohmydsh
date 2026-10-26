// Read-only, on-demand AUTO usage report (change auto-routing-usage-report).
// Never writes, spawns, or touches the network; never echoes message text, paths or session ids.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { zstdDecompressSync } from 'node:zlib'
import { FeedbackBook } from './feedback.js'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const
const FEEDBACK = ['appropriate', 'too-high', 'too-low', 'unknown'] as const
const CAVEATS = [
  'observational-not-controlled',
  'scope-main-session-assistant-calls-only',
  'only-applied-decisions-recorded',
  'token-semantics-differ-by-provider',
  'reference-before-auto-effort-only-confounded',
  'mode-history-not-persisted',
]
type Failure = 'decode-failed' | 'tail-incomplete' | 'parse-failed' | 'missing-log'
type Usage = Partial<Record<(typeof FIELDS)[number], number>>
interface Call { id: string; userTurn?: number; time: number; usage: Usage; model?: string; effort?: string }
interface Decision { session: string; version: string; model: string; depth: string; effort: string; calls: Call[]; feedback: Set<string> }

const sorted = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
const round = (n: number) => Math.round(n * 100) / 100
const bump = (record: Record<string, number>, key: string, by = 1) => { record[key] = (record[key] ?? 0) + by }

/** Split concatenated zstd frames; only a failing last segment counts as an unfinished tail. */
function decode(bytes: Buffer): { text: string; tail: boolean } | undefined {
  const starts: number[] = []
  for (let i = bytes.indexOf(MAGIC); i !== -1; i = bytes.indexOf(MAGIC, i + 1)) starts.push(i)
  if (starts[0] !== 0) return undefined
  let text = ''
  for (let i = 0; i < starts.length; i++) {
    try { text += zstdDecompressSync(bytes.subarray(starts[i], starts[i + 1])).toString('utf8') }
    catch { if (i === starts.length - 1) return { text, tail: true }; return undefined }
  }
  return { text, tail: false }
}

function lines(file: string, failures: Record<Failure, number>): unknown[] {
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { return [] }
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { failures['parse-failed']++ }
  }
  return out
}

function logPaths(home: string): Map<string, string> {
  const paths = new Map<string, string>()
  const root = join(home, 'sessions')
  let dirs: string[] = []
  try { dirs = readdirSync(root) } catch { return paths }
  for (const dir of dirs) {
    let ids: string[] = []
    try { ids = readdirSync(join(root, dir)) } catch { continue }
    for (const id of ids) { const file = join(root, dir, id, 'session.v4.jsonl.zstd'); if (existsSync(file)) paths.set(id, file) }
  }
  return paths
}

/** Calls in one session log, with the user turn each belongs to and the config in effect. */
function readSession(file: string, failures: Record<Failure, number>): { header: Record<string, unknown>; calls: Call[] } | undefined {
  let decoded: ReturnType<typeof decode>
  try { decoded = decode(readFileSync(file)) } catch { decoded = undefined }
  if (!decoded) { failures['decode-failed']++; return undefined }
  if (decoded.tail) failures['tail-incomplete']++
  const events: Record<string, any>[] = []
  for (const line of decoded.text.split('\n')) {
    if (!line.trim()) continue
    try { events.push(JSON.parse(line)) } catch { failures['parse-failed']++ }
  }
  const header = events.shift()
  if (header?.type !== 'session') { failures['decode-failed']++; return undefined }
  const calls: Call[] = []
  const seen = new Set<string>()
  let turn: number | undefined, userTurn: number | undefined
  let config: { model?: string; reasoningEffort?: string } = {}
  for (const event of events) {
    const data = event.data ?? {}
    if (event.type === 'turn/start') turn = data.turn
    else if (event.type === 'user/message' && data.source?.kind === 'user' && turn !== undefined) userTurn = turn
    else if (event.type === 'request/header' && data.header?.config) config = data.header.config
    else if (event.type === 'assistant/message') {
      const op = event.surfaceOp
      const append = op === undefined || op === 'append' || (typeof op === 'object' && op?.op === 'append')
      const id = data.message?.id
      if (!append || typeof id !== 'string' || seen.has(id)) continue
      seen.add(id)
      const usage: Usage = {}
      for (const field of FIELDS) if (typeof data.usage?.[field] === 'number') usage[field] = data.usage[field]
      calls.push({ id, ...(userTurn === undefined ? {} : { userTurn }), time: event.time, usage, ...(config.model ? { model: config.model } : {}), ...(config.reasoningEffort ? { effort: config.reasoningEffort } : {}) })
    }
  }
  return { header, calls }
}

function localMidnight(date: string): { ms: number; label: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const at = new Date(y, m - 1, d)
  const offset = -at.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0'), mm = String(Math.abs(offset) % 60).padStart(2, '0')
  return { ms: at.getTime(), label: `${date}T00:00:00${sign}${hh}:${mm}` }
}

function tokens(calls: Call[]) {
  const out: Record<string, { sum: number | null; mean: number | null; present: number; calls: number }> = {}
  for (const field of FIELDS) {
    const values = calls.map(c => c.usage[field]).filter((v): v is number => v !== undefined)
    const sum = values.reduce((a, b) => a + b, 0)
    out[field] = values.length ? { sum, mean: round(sum / values.length), present: values.length, calls: calls.length } : { sum: null, mean: null, present: 0, calls: calls.length }
  }
  return out
}

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b), mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

export function buildReport(home: string, options: { since?: string } = {}) {
  const failures: Record<Failure, number> = { 'decode-failed': 0, 'tail-incomplete': 0, 'parse-failed': 0, 'missing-log': 0 }
  const state = join(home, 'state/auto-model-routing')
  const since = options.since ? localMidnight(options.since) : undefined
  const after = (time: number) => !since || time >= since.ms

  const feedbackFile = join(state, 'allocation-feedback.jsonl')
  lines(feedbackFile, failures) // counts unparsable lines; FeedbackBook skips them silently
  const book = new FeedbackBook(feedbackFile)
  const bindings = book.entries()
  const legacyFirst = new Map<string, number>()
  for (const line of lines(join(state, 'judgements.jsonl'), failures) as Record<string, unknown>[]) {
    if (typeof line?.sessionId !== 'string' || !Number.isInteger(line.turn) || typeof line.tier !== 'string') continue
    legacyFirst.set(line.sessionId, Math.min(legacyFirst.get(line.sessionId) ?? Infinity, line.turn as number))
  }

  const ledgerSessions = [...new Set([...bindings.map(b => b.sessionId), ...legacyFirst.keys()])].sort()
  const paths = logPaths(home)
  const excluded = { child: 0, seeded: 0 }
  const decisions = new Map<string, Decision>()
  const reference: Record<string, { calls: number; sessions: Set<string>; effort: Record<string, number> }> = {}
  const autoEffort: Record<string, Record<string, number>> = {}
  let unlinkedBindings = 0, userTurns = 0, turnsWithoutRecord = 0

  for (const session of ledgerSessions) {
    const path = paths.get(session)
    if (!path) { failures['missing-log']++; continue }
    const log = readSession(path, failures)
    if (!log) continue
    if (log.header.origin) { excluded.child++; continue }
    if (log.header.isSeeded === true) { excluded.seeded++; continue }

    const linked = new Set<string>()
    let v2First: number | undefined
    for (const call of log.calls) {
      const b = book.lookup(session, call.id)
      if (!b) continue
      linked.add(call.id)
      if (call.userTurn !== undefined) v2First = Math.min(v2First ?? Infinity, call.userTurn)
      const key = JSON.stringify([session, b.decisionId])
      let d = decisions.get(key)
      if (!d) {
        d = { session, version: b.snapshot ? `${b.snapshot.policyVersion}/${b.snapshot.mappingVersion}` : 'unknown', model: b.model, depth: b.depth, effort: b.effort, calls: [], feedback: new Set() }
        decisions.set(key, d)
      }
      d.calls.push(call)
      if (b.feedback) d.feedback.add(b.feedback)
    }
    unlinkedBindings += bindings.filter(b => b.sessionId === session && !linked.has(b.messageId)).length

    // Coverage: user turns from the first v2 record on, with calls in range but none linked.
    if (v2First !== undefined) {
      const turns = new Map<number, boolean>()
      for (const call of log.calls) {
        if (call.userTurn === undefined || call.userTurn < v2First || !after(call.time)) continue
        turns.set(call.userTurn, (turns.get(call.userTurn) ?? false) || linked.has(call.id))
      }
      userTurns += turns.size
      turnsWithoutRecord += [...turns.values()].filter(v => !v).length
    }

    // Reference: calls before the earliest record in either ledger (effort only, never tokens).
    const first = Math.min(legacyFirst.get(session) ?? Infinity, v2First ?? Infinity)
    for (const call of log.calls) {
      if (call.userTurn === undefined || call.userTurn >= first || !after(call.time) || !call.model) continue
      const r = (reference[call.model] ??= { calls: 0, sessions: new Set(), effort: {} })
      r.calls++; r.sessions.add(session); bump(r.effort, call.effort ?? 'unknown')
    }
  }

  const kept = [...decisions.values()].filter(d => after(Math.min(...d.calls.map(c => c.time))))
  for (const d of kept) bump((autoEffort[d.model] ??= {}), d.effort, d.calls.length)

  const versions = new Map<string, Map<string, Decision[]>>()
  for (const d of kept) {
    const byVersion = versions.get(d.version) ?? new Map<string, Decision[]>()
    versions.set(d.version, byVersion)
    const key = JSON.stringify([d.model, d.depth])
    byVersion.set(key, [...(byVersion.get(key) ?? []), d])
  }
  const groups = [...versions].sort(([a], [b]) => a.localeCompare(b)).map(([version, subs]) => ({
    version,
    subgroups: [...subs].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
      const [model, depth] = JSON.parse(key) as [string, string]
      const calls = list.flatMap(d => d.calls)
      const sessions = new Set(list.map(d => d.session)).size
      const feedback: Record<string, number> = { ...Object.fromEntries(FEEDBACK.map(f => [f, 0])), conflict: 0, unrated: 0 }
      for (const d of list) bump(feedback, d.feedback.size === 0 ? 'unrated' : d.feedback.size > 1 ? 'conflict' : [...d.feedback][0]!)
      const byEffort: Record<string, { decisions: number; calls: number }> = {}
      for (const d of list) { const e = (byEffort[d.effort] ??= { decisions: 0, calls: 0 }); e.decisions++; e.calls += d.calls.length }
      return {
        model, depth, decisions: list.length, sessions, calls: calls.length,
        callsPerDecision: { median: median(list.map(d => d.calls.length)), max: Math.max(...list.map(d => d.calls.length)) },
        tokens: tokens(calls), byEffort: sorted(byEffort), feedback,
        conclusion: list.length >= 20 && sessions >= 3 ? 'observed' : 'insufficient-sample',
      }
    }),
  }))

  const recorded = new Set(ledgerSessions.map(s => createHash('sha256').update(s).digest('hex')))
  let autoSessionsWithoutRecord = 0
  let stateFiles: string[] = []
  try { stateFiles = readdirSync(join(state, 'sessions')).filter(f => f.endsWith('.json')).sort() } catch { /* none */ }
  for (const file of stateFiles) {
    let mode: unknown
    try { mode = JSON.parse(readFileSync(join(state, 'sessions', file), 'utf8'))?.mode } catch { failures['parse-failed']++; continue }
    if (mode === 'AUTO' && !recorded.has(file.slice(0, -5))) autoSessionsWithoutRecord++
  }

  return {
    schema: 1,
    since: since?.label ?? null,
    failures, excluded,
    coverage: { userTurns, turnsWithoutRecord, unlinkedBindings, autoSessionsWithoutRecord },
    groups,
    referenceBeforeAuto: Object.keys(reference).sort().map(model => ({
      model, calls: reference[model]!.calls, sessions: reference[model]!.sessions.size,
      effort: sorted(reference[model]!.effort), autoEffort: sorted(autoEffort[model] ?? {}),
    })),
    caveats: CAVEATS,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { since: { type: 'string' } } })
    if (values.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.since)) { process.stderr.write('usage-report: --since must be YYYY-MM-DD\n'); process.exit(2) }
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    process.stdout.write(`${JSON.stringify(buildReport(home, values.since ? { since: values.since } : {}), null, 2)}\n`)
  } catch {
    process.stderr.write('usage-report: failed\n')
    process.exit(1)
  }
}
