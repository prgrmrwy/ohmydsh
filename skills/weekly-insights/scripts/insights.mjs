#!/usr/bin/env node
// weekly-insights: local, streaming retrospective over DSH v4 session logs.
//
//   insights.mjs collect [--days N] [--project NAME] [--batches K]
//   insights.mjs ingest  <runDir>
//   insights.mjs stats   <runDir>
//   insights.mjs render  <runDir>
//
// collect  streams every session.v4.jsonl.zstd touched in the window (via the zstd CLI,
//          which decodes all concatenated frames), keeps only in-window events, skips the
//          inherited prefix of seeded sessions, folds subagent sessions into their root,
//          and writes per-root transcripts only for sessions without a valid cached facet.
// ingest   validates <runDir>/facets-*.jsonl written by the analysing agent and stores each
//          facet in the cache keyed by session id (plus a fingerprint of the analysed slice).
// stats    merges metrics + facets (cached or fresh) into <runDir>/summary.json for the agent.
// render   turns <runDir>/analysis.json + summary.json into <runDir>/report.html.
//
// Read-only over session logs. Writes only under $DSH_HOME/insights/weekly/. No network.
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const ROOT = join(DSH_HOME, 'insights', 'weekly')
const CACHE = join(ROOT, 'facets')
const TRANSCRIPT_MAX = 24000
const HEAD = 14000
const TAIL = 10000

export const ENUMS = {
  goal_category: ['implementation', 'debugging', 'research', 'review', 'configuration', 'planning', 'writing', 'discussion', 'ops_automation', 'other'],
  outcome: ['fully_achieved', 'mostly_achieved', 'partially_achieved', 'not_achieved', 'unclear'],
  user_satisfaction_signal: ['positive', 'neutral', 'negative', 'unclear'],
  friction: ['misunderstood_request', 'wrong_approach', 'buggy_output', 'tool_failure', 'excessive_exploration', 'premature_claim', 'user_interrupted', 'environment_issue', 'context_loss', 'over_engineering', 'instruction_violation', 'slow_or_long'],
  area: ['instructions', 'skill', 'tool', 'plugin', 'model_routing', 'memory', 'workflow', 'environment'],
}

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.slice(2).split(/=(.*)/s) : [a.slice(2), argv[++i]]
      if (v === undefined) throw new Error(`missing value for --${k}`)
      opts[k] = v
    } else opts._.push(a)
  }
  return opts
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, n)}…[+${t.length - n}]` : t)
const textOf = (content) => (Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : String(content ?? ''))
const shortId = (sessionId) => sessionId.replace(/^session-/, '').slice(0, 8)

function argSummary(args) {
  let a
  try { a = JSON.parse(args) } catch { return clip(String(args ?? ''), 120) }
  const pick = a?.command ?? a?.file_path ?? a?.pattern ?? a?.query ?? a?.description ?? a?.prompt ?? a?.url ?? a?.name ?? a?.slug ?? ''
  return clip(String(typeof pick === 'string' ? pick : JSON.stringify(pick)).replace(/\s+/g, ' '), 160)
}

export function listLogs(sessionsDir, sinceMs) {
  const files = []
  let dirs = []
  try { dirs = readdirSync(sessionsDir) } catch { return files }
  for (const d of dirs) {
    let subs
    try { subs = readdirSync(join(sessionsDir, d)) } catch { continue }
    for (const s of subs) {
      const f = join(sessionsDir, d, s, 'session.v4.jsonl.zstd')
      try { const st = statSync(f); if (st.mtimeMs >= sinceMs) files.push({ f, size: st.size }) } catch {}
    }
  }
  return files
}

/** Scan one log. Events are streamed; nothing but the bounded transcript is kept. */
export async function scanLog({ f, size }, sinceMs) {
  const z = spawn('zstd', ['-dcq', f], { stdio: ['ignore', 'pipe', 'ignore'] })
  const rl = createInterface({ input: z.stdout, crlfDelay: Infinity })
  const s = {
    file: f, compressedBytes: size, header: null, turns: 0, userMsgs: 0, steps: 0, tools: {}, toolErrors: {}, errorSamples: [],
    commands: [], skills: [], tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, models: {}, turnEnds: {}, turnErrSamples: [],
    firstTime: null, lastTime: null, lastSeq: -1, title: null, compactions: 0, transcript: [],
  }
  let inherited = false
  let tlen = 0
  const calls = new Map()
  const push = (line) => { if (tlen < 120000) { s.transcript.push(line); tlen += line.length } }
  for await (const l of rl) {
    let e
    try { e = JSON.parse(l) } catch { continue }
    if (e.type === 'session') { s.header = e; inherited = !!e.isSeeded; continue }
    if (e.type === 'session/end-seed') { inherited = false; continue }
    if (inherited) continue
    if (typeof e.time === 'number' && e.time < sinceMs) continue
    if (typeof e.time === 'number') { s.firstTime ??= e.time; s.lastTime = e.time }
    if (typeof e.seq === 'number') s.lastSeq = e.seq
    const d = e.data ?? {}
    switch (e.type) {
      case 'session/title': s.title = d.title ?? s.title; break
      case 'turn/start': s.turns++; break
      case 'step/start': s.steps++; break
      case 'compaction/start': s.compactions++; break
      case 'turn/end': {
        const k = d.reason?.kind ?? 'unknown'
        s.turnEnds[k] = (s.turnEnds[k] ?? 0) + 1
        if (k !== 'completed') {
          const msg = clip(JSON.stringify(d.reason).replace(/\s+/g, ' '), 200)
          if (s.turnErrSamples.length < 6) s.turnErrSamples.push(msg)
          push(`  [turn end: ${msg}]`)
        }
        break
      }
      case 'command/run': s.commands.push(d.name); push(`[command] /${d.name}`); break
      case 'user/message':
        if (d.source?.kind === 'user') { s.userMsgs++; push(`USER: ${clip(textOf(d.content), 1500)}`) }
        break
      case 'assistant/message': {
        const m = d.message ?? {}
        const u = d.usage ?? {}
        s.tokens.in += u.inputTokens ?? 0; s.tokens.out += u.outputTokens ?? 0
        s.tokens.cacheRead += u.cacheReadTokens ?? 0; s.tokens.cacheWrite += u.cacheWriteTokens ?? 0
        if (m.source?.model) { const k = `${m.source.provider}/${m.source.model}`; s.models[k] = (s.models[k] ?? 0) + 1 }
        const tx = (m.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').trim()
        if (tx) push(`AI: ${clip(tx.replace(/\s+/g, ' '), 500)}`)
        break
      }
      case 'tool/call':
        s.tools[d.name] = (s.tools[d.name] ?? 0) + 1
        calls.set(d.callId, d.name)
        if (d.name === 'skill') { try { s.skills.push(JSON.parse(d.arguments).name) } catch {} }
        push(`  tool ${d.name}: ${argSummary(d.arguments)}`)
        break
      case 'tool/result': {
        const m = d.message ?? {}
        const name = calls.get(m.toolCallId) ?? 'unknown'
        const body = textOf(m.content)
        if (m.isError || /\[exit code: [1-9]/.test(body)) {
          s.toolErrors[name] = (s.toolErrors[name] ?? 0) + 1
          const snippet = clip(body.replace(/\s+/g, ' '), 220)
          if (s.errorSamples.length < 12) s.errorSamples.push(`${name}: ${snippet}`)
          push(`  !! ${name} error: ${snippet}`)
        }
        break
      }
    }
  }
  const code = await new Promise((resolve) => (z.exitCode !== null ? resolve(z.exitCode) : z.on('close', resolve)))
  if (code !== 0 && !s.header) throw new Error(`zstd exited ${code}`)
  return s
}

export function boundTranscript(lines) {
  const tr = lines.join('\n')
  if (tr.length <= TRANSCRIPT_MAX) return tr
  return `${tr.slice(0, HEAD)}\n…[中间省略 ${tr.length - HEAD - TAIL} 字符]…\n${tr.slice(-TAIL)}`
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)
// A facet is reused until the session grows: last event seq is append-only per session.
const fingerprint = (s) => createHash('sha256').update(`${s.header.id}|${s.lastSeq}`).digest('hex').slice(0, 16)

function projectMatches(cwd, project) {
  if (!project) return true
  return basename(cwd) === project || cwd.split('/').includes(project)
}

export async function collect(opts) {
  const days = Number(opts.days ?? 7)
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number')
  const batches = Math.max(1, Number(opts.batches ?? 5))
  const now = Date.now()
  const sinceMs = now - days * 86400e3
  const sessionsDir = join(DSH_HOME, 'sessions')
  if (spawnSync('zstd', ['--version']).status !== 0) throw new Error('zstd CLI not found; install it (e.g. brew install zstd)')
  const files = listLogs(sessionsDir, sinceMs)
  const scanned = []
  const queue = [...files]
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const x = queue.shift()
      try { scanned.push(await scanLog(x, sinceMs)) } catch (err) { scanned.push({ file: x.f, error: String(err.message ?? err) }) }
    }
  }))
  const byId = new Map(scanned.filter((s) => s.header).map((s) => [s.header.id, s]))
  const rootOf = (s) => {
    let cur = s
    for (let i = 0; i < 10 && cur?.header?.delegationDepth > 0 && byId.has(cur.header.parentSession); i++) cur = byId.get(cur.header.parentSession)
    return cur
  }
  const roots = scanned.filter((s) => s.header && !(s.header.delegationDepth > 0) && s.turns > 0 && projectMatches(s.header.cwd, opts.project))
  const rootSet = new Set(roots)
  for (const r of roots) r.subagents = { count: 0, tools: 0, toolErrors: 0, tokensIn: 0 }
  for (const s of scanned) {
    if (!s.header || !(s.header.delegationDepth > 0)) continue
    const r = rootOf(s)
    if (!rootSet.has(r)) continue
    r.subagents.count++
    r.subagents.tools += sum(s.tools)
    r.subagents.toolErrors += sum(s.toolErrors)
    r.subagents.tokensIn += s.tokens.in + s.tokens.cacheRead + s.tokens.cacheWrite
  }

  const runId = new Date(now).toISOString().replace(/[:.]/g, '-')
  const runDir = join(ROOT, 'runs', runId)
  mkdirSync(join(runDir, 'transcripts'), { recursive: true })
  mkdirSync(CACHE, { recursive: true })
  const sessions = []
  const pending = []
  for (const s of roots.sort((a, b) => (a.firstTime ?? 0) - (b.firstTime ?? 0))) {
    const id = shortId(s.header.id)
    const toolCalls = sum(s.tools)
    const eligible = s.userMsgs >= 2 || (s.userMsgs >= 1 && toolCalls >= 5)
    const fp = fingerprint(s)
    const cached = readCache(s.header.id)
    const cacheHit = !!cached && cached.fingerprint === fp
    sessions.push({
      id, sessionId: s.header.id, project: basename(s.header.cwd), cwd: s.header.cwd, seeded: !!s.header.isSeeded, title: s.title,
      start: s.firstTime ? new Date(s.firstTime).toISOString() : null, end: s.lastTime ? new Date(s.lastTime).toISOString() : null,
      durMin: s.firstTime && s.lastTime ? Math.round((s.lastTime - s.firstTime) / 60000) : 0,
      turns: s.turns, userMsgs: s.userMsgs, steps: s.steps, toolCalls, toolErrors: sum(s.toolErrors), compactions: s.compactions,
      topTools: Object.entries(s.tools).sort((a, b) => b[1] - a[1]).slice(0, 8), toolErrorsBy: s.toolErrors, errorSamples: s.errorSamples,
      turnEnds: s.turnEnds, turnErrSamples: s.turnErrSamples, commands: s.commands, skills: s.skills, tokens: s.tokens, models: s.models,
      subagents: s.subagents, compressedBytes: s.compressedBytes, eligible, fingerprint: fp, cacheHit,
    })
    if (eligible && !cacheHit) {
      pending.push(id)
      const head = `# ${id} ${basename(s.header.cwd)} | ${s.title ?? ''}\n# turns=${s.turns} user=${s.userMsgs} tools=${toolCalls} toolErrors=${sum(s.toolErrors)} subagents=${s.subagents.count} durMin=${Math.round(((s.lastTime ?? 0) - (s.firstTime ?? 0)) / 60000)}\n`
      writeFileSync(join(runDir, 'transcripts', `${id}.txt`), `${head}${boundTranscript(s.transcript)}\n`)
    }
  }
  const batchLists = Array.from({ length: Math.min(batches, pending.length) }, () => [])
  pending.forEach((id, i) => batchLists[i % batchLists.length].push(id))
  batchLists.forEach((ids, i) => writeFileSync(join(runDir, `batch-${i}.list`), `${ids.map((id) => `${id}.txt`).join('\n')}\n`))
  const meta = {
    runId, days, project: opts.project ?? null, since: new Date(sinceMs).toISOString(), until: new Date(now).toISOString(),
    filesScanned: files.length, scanErrors: scanned.filter((s) => s.error).map((s) => ({ file: s.file, error: s.error })),
    sessions,
  }
  writeFileSync(join(runDir, 'meta.json'), JSON.stringify(meta, null, 1))
  return {
    runDir, filesScanned: files.length, roots: sessions.length, eligible: sessions.filter((x) => x.eligible).length,
    cached: sessions.filter((x) => x.eligible && x.cacheHit).length, pending: pending.length, batches: batchLists.length, scanErrors: meta.scanErrors.length,
  }
}

function cachePath(sessionId) { return join(CACHE, `${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`) }
function readCache(sessionId) {
  try { return JSON.parse(readFileSync(cachePath(sessionId), 'utf8')) } catch { return null }
}

export function validateFacet(f) {
  const problems = []
  const str = (k) => { if (typeof f[k] !== 'string' || !f[k].trim()) problems.push(`${k} missing`) }
  str('id'); str('summary')
  for (const k of ['goal_category', 'outcome', 'user_satisfaction_signal']) if (!ENUMS[k].includes(f[k])) problems.push(`${k}=${f[k]} not in enum`)
  if (!Array.isArray(f.frictions)) problems.push('frictions not array')
  else for (const x of f.frictions) if (!ENUMS.friction.includes(x?.type) || typeof x?.detail !== 'string') problems.push(`bad friction ${JSON.stringify(x)}`)
  if (!Array.isArray(f.harness_improvements)) problems.push('harness_improvements not array')
  else for (const x of f.harness_improvements) if (!ENUMS.area.includes(x?.area) || typeof x?.suggestion !== 'string') problems.push(`bad improvement ${JSON.stringify(x)}`)
  return problems
}

export function ingest(runDir) {
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'))
  const byShort = new Map(meta.sessions.map((s) => [s.id, s]))
  const files = readdirSync(runDir).filter((n) => /^facets-.*\.jsonl$/.test(n))
  const errors = []
  let stored = 0
  mkdirSync(CACHE, { recursive: true })
  for (const n of files) {
    readFileSync(join(runDir, n), 'utf8').split('\n').forEach((line, i) => {
      if (!line.trim()) return
      let f
      try { f = JSON.parse(line) } catch { errors.push(`${n}:${i + 1} invalid JSON`); return }
      const s = byShort.get(f.id)
      if (!s) { errors.push(`${n}:${i + 1} unknown id ${f.id}`); return }
      const p = validateFacet(f)
      if (p.length) { errors.push(`${n}:${i + 1} ${f.id}: ${p.join('; ')}`); return }
      writeFileSync(cachePath(s.sessionId), JSON.stringify({ sessionId: s.sessionId, fingerprint: s.fingerprint, analysedAt: new Date().toISOString(), windowDays: meta.days, facet: { ...f, project: s.project } }))
      stored++
    })
  }
  const missing = meta.sessions.filter((s) => s.eligible && readCache(s.sessionId)?.fingerprint !== s.fingerprint).map((s) => s.id)
  return { stored, errors, missing }
}

const tally = (items) => { const c = {}; for (const k of items) c[k] = (c[k] ?? 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]) }

export function stats(runDir) {
  const meta = JSON.parse(readFileSync(join(runDir, 'meta.json'), 'utf8'))
  const S = meta.sessions
  const facets = S.filter((s) => s.eligible).map((s) => { const c = readCache(s.sessionId); return c ? { ...c.facet, stale: c.fingerprint !== s.fingerprint } : null }).filter(Boolean)
  const add = (f) => S.reduce((a, s) => a + f(s), 0)
  const merge = (f) => { const o = {}; for (const s of S) for (const [k, v] of f(s)) o[k] = (o[k] ?? 0) + v; return Object.entries(o).sort((a, b) => b[1] - a[1]) }
  const inTok = add((s) => s.tokens.in + s.tokens.cacheRead + s.tokens.cacheWrite)
  const projects = {}
  for (const s of S) { const p = (projects[s.project] ??= { sessions: 0, userMsgs: 0, toolCalls: 0, toolErrors: 0 }); p.sessions++; p.userMsgs += s.userMsgs; p.toolCalls += s.toolCalls; p.toolErrors += s.toolErrors }
  const summary = {
    window: { since: meta.since, until: meta.until, days: meta.days, project: meta.project },
    coverage: { filesScanned: meta.filesScanned, scanErrors: meta.scanErrors.length, roots: S.length, eligible: S.filter((s) => s.eligible).length, facets: facets.length, staleFacets: facets.filter((f) => f.stale).length },
    totals: {
      userMsgs: add((s) => s.userMsgs), turns: add((s) => s.turns), toolCalls: add((s) => s.toolCalls), toolErrors: add((s) => s.toolErrors),
      compactions: add((s) => s.compactions), subagents: add((s) => s.subagents.count), subagentToolCalls: add((s) => s.subagents.tools), subagentToolErrors: add((s) => s.subagents.toolErrors),
      inputTokens: inTok, cacheHitRate: inTok ? +(add((s) => s.tokens.cacheRead) / inTok).toFixed(3) : null, outputTokens: add((s) => s.tokens.out), subagentInputTokens: add((s) => s.subagents.tokensIn),
    },
    projects,
    turnEnds: merge((s) => Object.entries(s.turnEnds)),
    turnErrorSamples: tally(S.flatMap((s) => s.turnErrSamples.map((t) => t.slice(0, 120)))).slice(0, 12),
    tools: merge((s) => s.topTools).slice(0, 15),
    toolErrors: merge((s) => Object.entries(s.toolErrorsBy)).slice(0, 15),
    models: merge((s) => Object.entries(s.models)),
    skills: tally(S.flatMap((s) => s.skills)).slice(0, 20),
    longest: [...S].sort((a, b) => b.toolCalls - a.toolCalls).slice(0, 8).map((s) => ({ id: s.id, project: s.project, title: s.title, toolCalls: s.toolCalls, toolErrors: s.toolErrors, durMin: s.durMin, subagents: s.subagents.count })),
    facetDistributions: {
      goal_category: tally(facets.map((f) => f.goal_category)),
      outcome: tally(facets.map((f) => f.outcome)),
      user_satisfaction_signal: tally(facets.map((f) => f.user_satisfaction_signal)),
      friction: tally(facets.flatMap((f) => [...new Set(f.frictions.map((x) => x.type))])),
      improvement_area: tally(facets.flatMap((f) => [...new Set(f.harness_improvements.map((x) => x.area))])),
    },
    facets,
  }
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 1))
  return summary
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const OUTCOME_ZH = { fully_achieved: '完全达成', mostly_achieved: '基本达成', partially_achieved: '部分达成', not_achieved: '未达成', unclear: '不明' }

export function render(runDir) {
  const S = JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'))
  const A = existsSync(join(runDir, 'analysis.json')) ? JSON.parse(readFileSync(join(runDir, 'analysis.json'), 'utf8')) : {}
  const list = (xs) => (Array.isArray(xs) ? xs : [])
  const bars = (rows) => { const max = Math.max(1, ...rows.map((r) => r[1])); return rows.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="width:${(v / max) * 100}%"></i><em>${v}</em></div>`).join('') }
  const T = S.totals
  const metrics = [
    ['窗口', `${S.window.since.slice(0, 10)} ~ ${S.window.until.slice(0, 10)}${S.window.project ? `（项目 ${S.window.project}）` : ''}`],
    ['覆盖', `扫描 ${S.coverage.filesScanned} 个日志，根会话 ${S.coverage.roots}，有效 ${S.coverage.eligible}，已打标签 ${S.coverage.facets}${S.coverage.scanErrors ? `，读取失败 ${S.coverage.scanErrors}` : ''}`],
    ['用户消息 / 回合', `${T.userMsgs} / ${T.turns}`],
    ['主会话工具调用', `${T.toolCalls}，报错 ${T.toolErrors}（${T.toolCalls ? ((T.toolErrors / T.toolCalls) * 100).toFixed(1) : 0}%）`],
    ['子会话', `${T.subagents} 个，工具调用 ${T.subagentToolCalls}，报错 ${T.subagentToolErrors}`],
    ['上下文压缩', String(T.compactions)],
    ['输入 token（根会话）', `${T.inputTokens.toLocaleString()}，缓存命中 ${T.cacheHitRate ?? '-'}`],
  ]
  const dists = { 回合结束方式: S.turnEnds, 工具报错: S.toolErrors.slice(0, 10), 目标类型: S.facetDistributions.goal_category, '结果（推断）': S.facetDistributions.outcome, 摩擦类型: S.facetDistributions.friction, 改进落点: S.facetDistributions.improvement_area }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(A.title ?? '会话洞察')}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1f2328;--mut:#6b7280;--card:#fff;--line:#e7e3da;--acc:#0f766e}
@media(prefers-color-scheme:dark){:root{--bg:#14171a;--fg:#e6e6e6;--mut:#9aa3ad;--card:#1c2024;--line:#2c3238;--acc:#2dd4bf}}
body{background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"PingFang SC",sans-serif;max-width:1040px;margin:0 auto;padding:32px 20px}
h1{font-size:26px;margin:0 0 6px}h2{font-size:19px;margin:36px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.mut{color:var(--mut);font-size:13px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 18px;margin:10px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.bar{display:grid;grid-template-columns:150px 1fr 48px;align-items:center;gap:8px;font-size:13px;margin:3px 0}.bar i{height:10px;background:var(--acc);border-radius:5px;display:block}.bar em{font-style:normal;text-align:right;color:var(--mut)}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
.tag{display:inline-block;font-size:12px;padding:1px 7px;border-radius:9px;background:var(--line);margin:1px}
pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:13px}
button{font-size:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:2px 8px;cursor:pointer}
details summary{cursor:pointer}
</style>
<h1>${esc(A.title ?? '会话洞察')}</h1><div class="mut">本地流式统计 + 逐会话打标签；结果为推断，未经用户确认。</div>
${list(A.glance).length ? `<h2>一眼看懂</h2>${list(A.glance).map((g) => `<div class="card">${esc(g)}</div>`).join('')}` : ''}
<h2>关键数字</h2><table>${metrics.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
<h2>分布</h2><div class="grid">${Object.entries(dists).filter(([, r]) => r.length).map(([t, rows]) => `<div class="card"><b>${esc(t)}</b>${bars(rows)}</div>`).join('')}</div>
${list(A.themes).length ? `<h2>反复出现的问题与 harness 改进点</h2>${list(A.themes).map((t) => `<div class="card"><b>${esc(t.title)}</b><p><span class="mut">依据：</span>${esc(t.evidence)}</p><p><span class="mut">改进：</span>${esc(t.fix)}</p>${t.where ? `<div class="mut">落点：${esc(t.where)}</div>` : ''}</div>`).join('')}` : ''}
${list(A.strengths).length ? `<h2>做得好的</h2>${list(A.strengths).map((s) => `<div class="card">${esc(s)}</div>`).join('')}` : ''}
${list(A.recommendations).length ? `<h2>建议（可直接复制给 agent）</h2>${list(A.recommendations).map((r, i) => `<div class="card"><b>${esc(r.title)}</b> <span class="mut">— ${esc(r.why)}</span><pre id="p${i}">${esc(r.prompt)}</pre><button onclick="navigator.clipboard.writeText(document.getElementById('p${i}').innerText)">复制</button></div>`).join('')}` : ''}
<h2>逐会话明细（${S.facets.length}）</h2>${S.facets.map((x) => `<details class="card"><summary><b>${esc(x.id)}</b> <span class="tag">${esc(x.project)}</span><span class="tag">${esc(OUTCOME_ZH[x.outcome] ?? x.outcome)}</span>${x.stale ? '<span class="tag">缓存已过期</span>' : ''} ${esc(x.summary)}</summary>
${x.frictions.length ? `<p>${x.frictions.map((f) => `<span class="tag">${esc(f.type)}</span> ${esc(f.detail)}`).join('<br>')}</p>` : ''}
${x.harness_improvements.length ? `<p class="mut">改进：${x.harness_improvements.map((h) => `[${esc(h.area)}] ${esc(h.suggestion)}`).join('；')}</p>` : ''}
${list(x.notable_user_corrections).length ? `<p class="mut">用户纠正：${x.notable_user_corrections.map(esc).join(' / ')}</p>` : ''}</details>`).join('')}
${list(A.caveats).length ? `<h2>局限</h2><ul>${list(A.caveats).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
</html>`
  const out = join(runDir, 'report.html')
  writeFileSync(out, html)
  return out
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const opts = parseArgs(rest)
  const runDir = opts._[0]
  const need = () => { if (!runDir || !existsSync(join(runDir, 'meta.json'))) throw new Error(`${cmd} needs a run directory produced by collect`) }
  let result
  switch (cmd) {
    case 'collect': result = await collect(opts); break
    case 'ingest': need(); result = ingest(runDir); if (result.errors.length) process.exitCode = 2; break
    case 'stats': need(); { const s = stats(runDir); result = { summary: join(runDir, 'summary.json'), coverage: s.coverage } } break
    case 'render': need(); result = { report: render(runDir) }; break
    default:
      console.error('usage: insights.mjs collect [--days N] [--project NAME] [--batches K] | ingest|stats|render <runDir>')
      process.exit(64)
  }
  console.log(JSON.stringify(result, null, 1))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => { console.error(`weekly-insights: ${err.message ?? err}`); process.exit(1) })
}
