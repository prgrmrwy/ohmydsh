import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const source = await readFile(new URL('../scripts/jev-readiness.mjs', import.meta.url), 'utf8')

test('readiness probe reports presence and names without exposing credential values', () => {
  assert.match(source, /valueInspected: false/)
  assert.match(source, /declaredVariables/)
  assert.doesNotMatch(source, /envValue|credentialValue|keyValue/)
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
    const lines = [JSON.stringify({ type: 'session', version: Number(version) }), JSON.stringify({ type: 'request/header', data: { header: { tools: tools.map(name => ({ name })) } } })].join('\n') + '\n'
    const zstd = spawnSync('zstd', ['-q', '-c'], { input: lines })
    assert.equal(zstd.status, 0)
    await writeFile(path.join(sessionDir, `session.v${version}.jsonl.zstd`), zstd.stdout)
  }
  return { repo, home }
}

function runReadiness({ repo, home }, env = {}) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
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
    assert.equal(Boolean(report.liveProbeReady), live, JSON.stringify(Object.keys(sessions)))
  }
})
