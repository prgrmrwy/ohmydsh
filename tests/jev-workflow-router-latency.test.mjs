import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import {
  decodeZstdFrames,
  decodeZstdText,
  encodeZstdFrames,
  findSessionLog,
  readSessionLogFile,
} from '../skills/jev-workflow-router/session-log.mjs'

const recorder = new URL('../skills/jev-workflow-router/recorder.mjs', import.meta.url)

async function temporaryHome(t) {
  const directory = await mkdtemp(join(tmpdir(), 'jev-latency-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

function run(home, args, input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [recorder.pathname, ...args], {
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_JEV_WORKFLOW_ROUTER_DISABLED: '',
        ...extraEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', code => resolve({
      code,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }))
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input))
  })
}

function recordInput(extra = {}) {
  return {
    sampleProvenance: 'synthetic-fixture',
    eligibleCandidates: ['direct', 'standard-openspec', 'anvil', 'spec-superflow'],
    recommendation: {
      changeNecessity: 'formal-workflow',
      workflow: 'anvil',
      classificationProbabilities: { direct: 0.05, 'formal-workflow': 0.9, 'manual-review': 0.05 },
      workflowProbabilities: {
        'standard-openspec': 0.05, anvil: 0.9, 'spec-superflow': 0.03,
        ask_user: 0.01, investigate: 0.005, none: 0.005,
      },
      confidence: 0.9,
      margin: 0.7,
      escape: false,
      status: 'auto-candidate',
      requirementChecks: {
        eligibleChoice: true, completeProbabilities: true, confidenceMet: true,
        marginMet: true, safetyCompatible: true,
      },
    },
    errorCategory: 'none',
    ...extra,
  }
}

async function writeLog(home, sessionId, frames, name = 'session.v4.jsonl.zstd') {
  const dir = join(home, 'sessions', 'ws', sessionId)
  await mkdir(dir, { recursive: true })
  const text = frames.map(lines => lines.map(line => `${JSON.stringify(line)}\n`).join('')).join('')
  await writeFile(join(dir, name), encodeZstdFrames(frames.map(lines => lines.map(line => `${JSON.stringify(line)}\n`).join(''))))
  return text
}

async function storedRecords(home) {
  const text = await readFile(join(home, 'state', 'jev-workflow-router', 'records.v1.jsonl'), 'utf8')
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

test('multi-frame logs decode completely, never just the first frame', () => {
  // Node's whole-buffer zstd API stops after the first frame and reports
  // success; a decoder that trusts it silently loses every later frame.
  const frames = encodeZstdFrames(['first\n', 'second\n', 'third\n'])
  const chunks = decodeZstdFrames(frames)
  assert.equal(chunks.length, 3)
  const decoded = decodeZstdText(frames)
  assert.equal(decoded.ok, true)
  assert.equal(decoded.frames, 3)
  assert.equal(decoded.text, 'first\nsecond\nthird\n')
})

test('single-frame logs still decode, and empty or garbage input is refused', () => {
  const single = encodeZstdFrames(['only\n'])
  const decoded = decodeZstdText(single)
  assert.equal(decoded.ok, true)
  assert.equal(decoded.text, 'only\n')
  assert.equal(decodeZstdText(Buffer.alloc(0)).ok, false)
  assert.equal(decodeZstdText(Buffer.from('not zstd at all')).ok, false)
})

test('session log lookup prefers v4 and reports specific reasons', async t => {
  const home = await temporaryHome(t)
  assert.equal(findSessionLog({ dshHome: home, sessionId: '' }).reason, 'no-session-id')
  assert.equal(findSessionLog({ dshHome: home, sessionId: 'x' }).reason, 'sessions-root-missing')
  await writeLog(home, 'session-x', [[{ type: 'request/header', data: { header: { tools: [] } } }]])
  const located = findSessionLog({ dshHome: home, sessionId: 'session-x' })
  assert.equal(located.name, 'session.v4.jsonl.zstd')
  assert.equal(findSessionLog({ dshHome: home, sessionId: 'session-absent' }).reason, 'session-file-missing')
  assert.equal(readSessionLogFile(join(home, 'nope')).reason, 'session-file-missing')
})

test('latency is summed from session event timestamps, not agent self-timing', async t => {
  const home = await temporaryHome(t)
  const sessionId = 'session-lat'
  await writeLog(home, sessionId, [
    [
      { type: 'tool/call', time: 1000, data: { name: 'mcp__jev__jev_classify', callId: 'c1' } },
      { type: 'tool/result', time: 1801, data: { toolCallId: 'c1' } },
    ],
    [
      { type: 'tool/call', time: 2000, data: { name: 'mcp__jev__jev_decide', callId: 'c2' } },
      { type: 'tool/result', time: 3701, data: { toolCallId: 'c2' } },
    ],
  ])
  const env = { DSH_SESSION_ID: sessionId }
  const recorded = await run(home, ['record'], recordInput({ observedWindow: { from: 500, to: 5000 } }), env)
  assert.equal(recorded.code, 0, recorded.stderr)
  const id = JSON.parse(recorded.stdout).observationId

  const measured = await run(home, ['latency', id], undefined, env)
  assert.equal(measured.code, 0, measured.stderr)
  const outcome = JSON.parse(measured.stdout)
  assert.equal(outcome.measured, true)
  assert.equal(outcome.calls, 2)
  // 801 ms + 1701 ms, taken from the log rather than from two agent steps.
  assert.equal(outcome.milliseconds, 2502)

  const [record] = await storedRecords(home)
  assert.deepEqual(record.metrics.latency, { availability: 'measured', milliseconds: 2502, truncated: false })
})

test('the observed window keeps foreign Jev calls out of a judgement', async t => {
  const home = await temporaryHome(t)
  const sessionId = 'session-window'
  await writeLog(home, sessionId, [[
    { type: 'tool/call', time: 100, data: { name: 'mcp__jev__jev_classify', callId: 'old' } },
    { type: 'tool/result', time: 9100, data: { toolCallId: 'old' } },
    { type: 'tool/call', time: 1000, data: { name: 'mcp__jev__jev_classify', callId: 'mine' } },
    { type: 'tool/result', time: 1700, data: { toolCallId: 'mine' } },
    { type: 'tool/call', time: 2000, data: { name: 'other_tool', callId: 'unrelated' } },
    { type: 'tool/result', time: 29000, data: { toolCallId: 'unrelated' } },
  ]])
  const env = { DSH_SESSION_ID: sessionId }
  const recorded = await run(home, ['record'], recordInput({ observedWindow: { from: 900, to: 2500 } }), env)
  const id = JSON.parse(recorded.stdout).observationId
  const outcome = JSON.parse((await run(home, ['latency', id], undefined, env)).stdout)
  assert.equal(outcome.calls, 1)
  assert.equal(outcome.milliseconds, 700)
})

test('latency reports unavailable with a reason instead of guessing', async t => {
  const home = await temporaryHome(t)
  const recorded = await run(home, ['record'], recordInput(), { DSH_SESSION_ID: '' })
  const id = JSON.parse(recorded.stdout).observationId

  // No session id at all.
  const noId = JSON.parse((await run(home, ['latency', id], undefined, { DSH_SESSION_ID: '' })).stdout)
  assert.equal(noId.measured, false)
  assert.equal(noId.reason, 'no-session-id')

  // A log for some other session exists, so the sessions root is present and
  // the absence is specifically this session's file.
  await writeLog(home, 'session-other', [[{ type: 'request/header', data: { header: { tools: [] } } }]])
  const noFile = JSON.parse((await run(home, ['latency', id], undefined, { DSH_SESSION_ID: 'session-absent' })).stdout)
  assert.equal(noFile.measured, false)
  assert.equal(noFile.reason, 'session-file-missing')

  // A log with no matching Jev calls.
  const sessionId = 'session-empty'
  await writeLog(home, sessionId, [[{ type: 'request/header', data: { header: { tools: [] } } }]])
  const noCalls = JSON.parse((await run(home, ['latency', id], undefined, { DSH_SESSION_ID: sessionId })).stdout)
  assert.equal(noCalls.measured, false)
  assert.equal(noCalls.reason, 'no-matching-calls')

  const [record] = await storedRecords(home)
  assert.equal(record.metrics.latency.availability, 'unavailable')
  assert.equal(record.metrics.latency.milliseconds, null)
  assert.equal(record.metrics.latency.reason, 'no-matching-calls')
})

test('latency rejects an unknown observation instead of inventing one', async t => {
  const home = await temporaryHome(t)
  await writeLog(home, 'session-x', [[{ type: 'request/header', data: { header: { tools: [] } } }]])
  const result = await run(home, ['latency', '0123456789abcdef'], undefined, { DSH_SESSION_ID: 'x' })
  assert.equal(result.code, 0, result.stderr)
  const outcome = JSON.parse(result.stdout)
  assert.equal(outcome.measured, false)
  assert.equal(outcome.reason, 'session-file-missing')
  const bad = await run(home, ['latency', 'not-an-id'])
  assert.equal(bad.code, 1)
})

test('long sequences keep their real value instead of a silent 60s clamp', async t => {
  const home = await temporaryHome(t)
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, [recorder.pathname, 'record'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, DSH_JEV_WORKFLOW_ROUTER_DISABLED: '' },
    input: JSON.stringify(recordInput({ metrics: { latency: { availability: 'measured', milliseconds: 80_057 } } })),
  })
  assert.equal(result.status, 0, result.stderr)
  const [record] = await storedRecords(home)
  // The historical case: a real 80 057 ms sequence used to be stored as 60 000.
  assert.equal(record.metrics.latency.milliseconds, 80_057)
  assert.equal(record.metrics.latency.truncated, false)
})

test('overflow beyond the storage ceiling is marked, never silently rewritten', async t => {
  const home = await temporaryHome(t)
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync(process.execPath, [recorder.pathname, 'record'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, DSH_JEV_WORKFLOW_ROUTER_DISABLED: '' },
    input: JSON.stringify(recordInput({ sampleProvenance: 'real-vibe', metrics: { latency: { availability: 'measured', milliseconds: 9_000_000 } } })),
  })
  assert.equal(result.status, 0, result.stderr)
  const [record] = await storedRecords(home)
  assert.equal(record.metrics.latency.truncated, true)
  const report = JSON.parse((await run(home, ['report'])).stdout)
  assert.equal(report.health.latencyTruncatedSamples, 1)
  assert.ok(report.health.warnings.some(w => w.code === 'latency-samples-truncated'))
})
