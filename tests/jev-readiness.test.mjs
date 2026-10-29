import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { encodeZstdFrames } from '../skills/jev-workflow-router/session-log.mjs'

const source = await readFile(new URL('../scripts/jev-readiness.mjs', import.meta.url), 'utf8')

test('readiness probe reports presence and names without exposing credential values', () => {
  assert.match(source, /valueInspected: false/)
  assert.match(source, /declaredVariables/)
  assert.doesNotMatch(source, /envValue|credentialValue|keyValue/)
})

test('readiness probe reads session logs without an external zstd binary', () => {
  // The old probe shelled out to `zstd -dc`; on a machine without that binary it
  // reported decodeFailed forever. Decoding must go through Node itself.
  assert.doesNotMatch(source, /spawnSync\('zstd'/)
  assert.doesNotMatch(source, /decodeFailed/)
  assert.match(source, /findSessionLog/)
  assert.match(source, /readSessionLogFile/)
})

test('readiness probe only retains request-header tool names and skill-presence facts', () => {
  assert.match(source, /event\.type === 'request\/header'/)
  assert.match(source, /event\.data\?\.source\?\.kind === 'skill-catalog'/)
  assert.match(source, /jevTools:/)
  assert.match(source, /specSuperflowSkills:/)
  assert.match(source, /liveProbeReady: session\.jevTools\?\.includes\('mcp__jev__jev_classify'\)/)
  assert.doesNotMatch(source, /liveProbeReady: Boolean\(process\.env\.TYPESAFE_API_KEY\)/)
  assert.doesNotMatch(source, /user\/message'[\s\S]*console\.log/)
  assert.doesNotMatch(source, /assistant\/message/)
})

const script = new URL('../scripts/jev-readiness.mjs', import.meta.url).pathname

async function readinessFixture(t, { credentialEnv = 'OPENROUTER_API_KEY', sessions = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jev-readiness-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const repo = path.join(root, 'repo')
  const home = path.join(root, 'home')
  await mkdir(repo, { recursive: true })
  await writeFile(path.join(repo, 'dsh.yaml'), `thirdPartyResources:\n  - id: jev\n    type: npm-mcp-server\n    jevProvider: openrouter\n    credentialEnv: ${credentialEnv}\n    version: 0.14.5\n    bridge: { version: 0.2.0-rc.2 }\n`)
  const sessionDir = path.join(home, 'sessions', 'ws', 'session-1')
  await mkdir(sessionDir, { recursive: true })
  for (const [version, tools] of Object.entries(sessions)) {
    // Two frames per log: real DSH logs are multi-frame, and a decoder that only
    // reads the first frame must not look like success.
    const header = JSON.stringify({ type: 'session', version: Number(version) }) + '\n'
      + JSON.stringify({ type: 'request/header', data: { header: { tools: tools.map(name => ({ name })) } } }) + '\n'
    const catalog = JSON.stringify({
      type: 'user/message',
      data: { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'jev-workflow-router and spec-superflow skills' }] },
    }) + '\n'
    const zstd = encodeZstdFrames([header, catalog])
    assert.ok(zstd.length > 0)
    await writeFile(path.join(sessionDir, `session.v${version}.jsonl.zstd`), zstd)
  }
  return { repo, home }
}

function runReadiness({ repo, home }, env = {}) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    // A PATH without zstd proves the probe does not depend on the binary.
    env: { PATH: process.env.PATH, DSH_HOME: home, DSH_REPO_ROOT: repo, DSH_SESSION_ID: 'session-1', ...env },
  })
  assert.equal(result.status, 0, result.stderr)
  return { report: JSON.parse(result.stdout), raw: result.stdout + result.stderr }
}

test('readiness reports configured credential variable without its value', async t => {
  const fixture = await readinessFixture(t)
  const { report, raw } = runReadiness(fixture, { OPENROUTER_API_KEY: 'readiness-secret' })
  assert.equal(report.credential.variable, 'OPENROUTER_API_KEY')
  assert.equal(report.credential.currentProcess, true)
  assert.doesNotMatch(raw, /readiness-secret/)
})

test('readiness prefers v4 session file and falls back to v3', async t => {
  const jev = ['mcp__jev__jev_classify', 'mcp__jev__jev_decide']
  for (const [sessions, live] of [[{ 4: jev }, true], [{ 3: [] }, false], [{ 4: jev, 3: [] }, true]]) {
    const { report } = runReadiness(await readinessFixture(t, { sessions }))
    assert.equal(report.currentSession.available, true, JSON.stringify(Object.keys(sessions)))
    assert.equal(report.currentSession.file, `session.v${Object.keys(sessions).includes('4') ? 4 : 3}.jsonl.zstd`)
    assert.equal(Boolean(report.liveProbeReady), live, JSON.stringify(Object.keys(sessions)))
  }
})

test('readiness decodes every frame, not only the first', async t => {
  const jev = ['mcp__jev__jev_classify', 'mcp__jev__jev_decide']
  const { report } = runReadiness(await readinessFixture(t, { sessions: { 4: jev } }))
  // The catalog lives in the second frame; routerSkill can only be true if both
  // frames were decoded.
  assert.equal(report.currentSession.frames, 2)
  assert.equal(report.currentSession.routerSkill, true)
})

test('readiness reports an actionable reason when the session cannot be read', async t => {
  // Missing session id, missing file, and corrupt log each get their own reason
  // instead of one opaque boolean, and none of them fail the probe.
  const fixture = await readinessFixture(t)
  const noId = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, DSH_HOME: fixture.home, DSH_REPO_ROOT: fixture.repo, DSH_SESSION_ID: '' },
  })
  assert.equal(noId.status, 0, noId.stderr)
  assert.equal(JSON.parse(noId.stdout).currentSession.reason, 'no-session-id')

  const missing = runReadiness({ ...fixture }, { DSH_SESSION_ID: 'session-absent' })
  assert.equal(missing.report.currentSession.available, false)
  assert.equal(missing.report.currentSession.reason, 'session-file-missing')

  const sessionDir = path.join(fixture.home, 'sessions', 'ws', 'session-broken')
  await mkdir(sessionDir, { recursive: true })
  await writeFile(path.join(sessionDir, 'session.v4.jsonl.zstd'), 'not a zstd stream')
  const corrupt = runReadiness({ ...fixture }, { DSH_SESSION_ID: 'session-broken' })
  assert.equal(corrupt.report.currentSession.available, false)
  assert.equal(corrupt.report.currentSession.reason, 'decode-failed')
  // Other readiness facts survive a session-only failure.
  assert.equal(corrupt.report.profile.exactPackages.jev, false)
  assert.equal(corrupt.report.credential.variable, 'OPENROUTER_API_KEY')
})
