// skills/weekly-insights: streaming collect over multi-frame zstd v4 logs, window and
// seeded-prefix filtering, subagent folding, --project, facet validation and the
// session-id facet cache (fingerprint invalidates when the session grows).
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import zlib from 'node:zlib'

const SCRIPT = new URL('../skills/weekly-insights/scripts/insights.mjs', import.meta.url).pathname
const hasZstd = spawnSync('zstd', ['--version']).status === 0 && typeof zlib.zstdCompressSync === 'function'

function run(home, args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home } })
  return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr }
}

const now = Date.now()
const day = 86400e3

/** Write events as one zstd frame per line, like DSH appends. */
function writeLog(home, cwdKey, id, events) {
  const dir = join(home, 'sessions', cwdKey, id)
  mkdirSync(dir, { recursive: true })
  const f = join(dir, 'session.v4.jsonl.zstd')
  writeFileSync(f, Buffer.concat(events.map((e) => zlib.zstdCompressSync(`${JSON.stringify(e)}\n`))))
  return f
}

function turn(seq, t, text, { tool = 'bash', error = false } = {}) {
  return [
    { type: 'turn/start', seq, time: t, data: { turn: 1 } },
    { type: 'user/message', seq: seq + 1, time: t, data: { content: [{ type: 'text', text }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: seq + 2, time: t, data: { message: { content: [{ type: 'text', text: 'ok' }], source: { provider: 'p', model: 'm' } }, usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 10, cacheWriteTokens: 0 } } },
    ...Array.from({ length: 5 }, (_, i) => [
      { type: 'tool/call', seq: seq + 3 + i * 2, time: t, data: { callId: `c${seq}-${i}`, name: tool, arguments: '{"command":"ls"}' } },
      { type: 'tool/result', seq: seq + 4 + i * 2, time: t, data: { message: { toolCallId: `c${seq}-${i}`, isError: error && i === 0, content: [{ type: 'text', text: 'x' }] } } },
    ]).flat(),
    { type: 'turn/end', seq: seq + 13, time: t, data: { reason: { kind: 'completed' } } },
  ]
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'wi-'))
  const recent = now - day
  const old = now - 30 * day
  const root = [{ type: 'session', id: 'session-root0001', cwd: '/w/alpha', isSeeded: false, delegationDepth: 0 }, ...turn(0, old, 'OLD-EVENT'), ...turn(20, recent, 'hello', { error: true }), ...turn(40, recent, 'again')]
  const rootLog = writeLog(home, 'alpha', 'session-root0001', root)
  writeLog(home, 'alpha', 'session-sub00001', [{ type: 'session', id: 'session-sub00001', cwd: '/w/alpha', isSeeded: false, delegationDepth: 1, parentSession: 'session-root0001' }, ...turn(0, recent, 'sub task')])
  writeLog(home, 'beta', 'session-fork0001', [
    { type: 'session', id: 'session-fork0001', cwd: '/w/beta', isSeeded: true, delegationDepth: 0, parentSession: 'session-root0001' },
    ...turn(0, recent, 'INHERITED'), { type: 'session/end-seed', seq: 14, time: recent, data: {} }, ...turn(15, recent, 'own one'), ...turn(30, recent, 'own two'),
  ])
  return { home, rootLog, recent }
}

test('collect streams multi-frame logs, filters window/seed, folds subagents, honours --project', { skip: !hasZstd && 'zstd unavailable' }, () => {
  const { home } = fixture()
  const r = run(home, ['collect', '--days', '7'])
  assert.equal(r.status, 0, r.err)
  assert.equal(r.out.roots, 2)
  assert.equal(r.out.pending, 2)
  const meta = JSON.parse(readFileSync(join(r.out.runDir, 'meta.json'), 'utf8'))
  const alpha = meta.sessions.find((s) => s.project === 'alpha')
  assert.equal(alpha.userMsgs, 2, 'the 30-day-old turn is outside the window')
  assert.equal(alpha.toolErrors, 1)
  assert.equal(alpha.subagents.count, 1)
  const t = readFileSync(join(r.out.runDir, 'transcripts', `${alpha.id}.txt`), 'utf8')
  assert.doesNotMatch(t, /OLD-EVENT/)
  const fork = readFileSync(join(r.out.runDir, 'transcripts', `${meta.sessions.find((s) => s.project === 'beta').id}.txt`), 'utf8')
  assert.doesNotMatch(fork, /INHERITED/)
  assert.match(fork, /own one/)

  const p = run(home, ['collect', '--days', '7', '--project', 'beta'])
  assert.equal(p.out.roots, 1)
})

test('ingest validates facets, caches by session id, and invalidates when the session grows', { skip: !hasZstd && 'zstd unavailable' }, () => {
  const { home, rootLog, recent } = fixture()
  const first = run(home, ['collect', '--days', '7']).out
  const meta = JSON.parse(readFileSync(join(first.runDir, 'meta.json'), 'utf8'))
  const facet = (id) => ({ id, summary: '测试', goal_category: 'debugging', outcome: 'fully_achieved', user_satisfaction_signal: 'neutral', frictions: [{ type: 'tool_failure', detail: 'x' }], harness_improvements: [] })
  writeFileSync(join(first.runDir, 'facets-0.jsonl'), [...meta.sessions.map((s) => JSON.stringify(facet(s.id))), JSON.stringify({ ...facet('nope') }), JSON.stringify({ ...facet(meta.sessions[0].id), outcome: 'great' })].join('\n'))
  const ing = run(home, ['ingest', first.runDir])
  assert.equal(ing.status, 2)
  assert.equal(ing.out.stored, 2)
  assert.equal(ing.out.errors.length, 2)
  assert.equal(readdirSync(join(home, 'insights', 'weekly', 'facets')).length, 2)

  const second = run(home, ['collect', '--days', '7']).out
  assert.equal(second.cached, 2)
  assert.equal(second.pending, 0)

  appendFileSync(rootLog, zlib.zstdCompressSync(`${JSON.stringify(turn(60, recent, 'more')[1])}\n`))
  const third = run(home, ['collect', '--days', '7']).out
  assert.equal(third.cached, 1)
  assert.equal(third.pending, 1)

  const st = run(home, ['stats', second.runDir])
  assert.equal(st.status, 0, st.err)
  assert.equal(st.out.coverage.facets, 2)
  const rd = run(home, ['render', second.runDir])
  assert.equal(rd.status, 0, rd.err)
  assert.match(readFileSync(rd.out.report, 'utf8'), /逐会话明细（2）/)
})
