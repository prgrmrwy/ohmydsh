import assert from 'node:assert/strict'
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

const recorder = new URL('../skills/jev-workflow-router/recorder.mjs', import.meta.url)
const skill = new URL('../skills/jev-workflow-router/SKILL.md', import.meta.url)

async function temporaryHome(t) {
  const directory = await import('node:fs/promises').then(({ mkdtemp }) =>
    mkdtemp(join(tmpdir(), 'jev-workflow-router-')),
  )
  t.after(() => import('node:fs/promises').then(({ rm }) => rm(directory, { recursive: true, force: true })))
  return directory
}

function run(home, args, input, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [recorder.pathname, ...args], {
      env: {
        ...process.env,
        DSH_HOME: home,
        DSH_JEV_WORKFLOW_ROUTER_DISABLED: '',
        DSH_JEV_WORKFLOW_ROUTER_MAX_COUNT: '',
        DSH_JEV_WORKFLOW_ROUTER_MAX_BYTES: '',
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

function recordsPath(home) {
  return join(home, 'state', 'jev-workflow-router', 'records.v1.jsonl')
}

async function storedRecords(home) {
  const text = await readFile(recordsPath(home), 'utf8')
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function sample(index = 0) {
  return {
    observationId: `attacker-controlled-${index}`,
    fullPrompt: 'PRIVATE full prompt should not persist',
    source: 'const privateSource = true',
    diff: '+ secret line',
    attachment: { name: 'payroll-secret.pdf', path: '/private/payroll-secret.pdf' },
    email: 'private-person@example.invalid',
    url: 'https://example.invalid/private?q=secret',
    token: 'token-like-value-should-not-persist',
    providerError: { message: 'raw provider error echoed private request' },
    arbitrary: { deeply: ['nested', 'unknown', 'data'] },
    features: {
      intent: 'feature',
      scope: 'single-module',
      behaviorChange: true,
      persistence: false,
      concurrency: false,
      existingChange: false,
      safetyGateConflict: false,
      externalSystems: 1,
      safetyRisk: 'low',
      migrationRisk: 'none',
      explicitRoute: 'unknown',
      malicious: 'do not persist me',
    },
    eligibleCandidates: ['direct', 'standard-openspec', 'anvil', '../evil'],
    recommendation: {
      changeNecessity: 'formal-workflow',
      workflow: 'standard-openspec',
      classificationProbabilities: {
        direct: 0.1,
        'formal-workflow': 0.85,
        'manual-review': 0.05,
        malicious: 999,
      },
      workflowProbabilities: {
        'standard-openspec': 0.65,
        anvil: 0.15,
        'spec-superflow': 0.1,
        ask_user: 0.04,
        investigate: 0.03,
        none: 0.03,
        malicious: 999,
      },
      confidence: 0.8,
      margin: 0.5,
      escape: false,
      requirementChecks: {
        eligibleChoice: true,
        completeProbabilities: true,
        confidenceMet: true,
        marginMet: true,
        safetyCompatible: true,
        malicious: true,
      },
      status: 'auto-candidate',
      raw: 'unbounded model output',
    },
    metrics: {
      latencyMs: 17,
      usage: { input: 3, output: 2, total: 5, rawCost: '$secret' },
      unknown: 'do not persist',
    },
    errorCategory: 'none',
  }
}

test('skill is an observation-only closed two-step shadow router', async () => {
  const source = await readFile(skill, 'utf8')
  assert.match(source, /independently reach(?:ed|ing) the workflow decision point/iu)
  assert.match(source, /mcp__jev__jev_classify/u)
  assert.match(source, /mcp__jev__jev_decide/u)
  assert.match(source, /observation-only/iu)
  assert.match(source, /never show a recommendation as a question or a user-visible interruption/iu)
  assert.match(source, /active managed Worktree Session[\s\S]*remove `spec-superflow`[\s\S]*`ssf isolate`[\s\S]*`ssf finish`/iu)
  assert.match(source, /instructions or warnings alone do not qualify/iu)
  for (const route of ['direct', 'standard-openspec', 'anvil', 'spec-superflow']) {
    assert.match(source, new RegExp(`\\b${route}\\b`, 'u'))
  }
  for (const forbidden of ['full prompt', 'source fragments', 'diff', 'attachment', 'provider errors']) {
    assert.match(source, new RegExp(forbidden, 'iu'))
  }
})

test('record persists only normalized bounded fields and never attacker observation ids', async t => {
  const home = await temporaryHome(t)
  const result = await run(home, ['record'], sample())
  assert.equal(result.code, 0, result.stderr)
  const response = JSON.parse(result.stdout)
  assert.equal(response.recorded, true)
  assert.match(response.observationId, /^[a-f0-9-]{36}$/u)

  const text = await readFile(recordsPath(home), 'utf8')
  for (const secret of [
    'PRIVATE full prompt', 'privateSource', 'secret line', 'payroll-secret.pdf', '/private/',
    'private-person@', 'example.invalid', 'token-like', 'raw provider error', 'attacker-controlled',
    'unbounded model output', 'do not persist', '$secret', '../evil',
  ]) {
    assert.equal(text.includes(secret), false, secret)
  }

  const [record] = await storedRecords(home)
  assert.deepEqual(Object.keys(record).sort(), [
    'actualRoute', 'candidateCatalogVersion', 'eligibleCandidates', 'errorCategory', 'features',
    'metrics', 'observationId', 'overrideSource', 'recommendation', 'recordedAt', 'routerVersion',
    'schemaVersion',
  ].sort())
  assert.deepEqual(record.eligibleCandidates, ['direct', 'standard-openspec', 'anvil'])
  assert.deepEqual(Object.keys(record.recommendation.classificationProbabilities), [
    'direct', 'formal-workflow', 'manual-review',
  ])
  assert.deepEqual(Object.keys(record.recommendation.workflowProbabilities), [
    'standard-openspec', 'anvil', 'spec-superflow', 'ask_user', 'investigate', 'none',
  ])
  assert.equal(record.actualRoute, 'unknown')
  assert.equal(record.overrideSource, 'unknown')
})

test('record normalizes invalid enums and non-finite or out-of-range numbers', async t => {
  const home = await temporaryHome(t)
  const input = sample()
  input.features.intent = 'DROP TABLE'
  input.features.externalSystems = 999
  input.recommendation.workflow = '/private/path'
  input.recommendation.classificationProbabilities.direct = Number.NaN
  input.recommendation.confidence = null
  input.recommendation.margin = 99
  input.metrics.latencyMs = -5
  input.metrics.usage.total = Number.POSITIVE_INFINITY
  input.errorCategory = 'raw: secret endpoint failed'

  const result = await run(home, ['record'], input)
  assert.equal(result.code, 0, result.stderr)
  const [record] = await storedRecords(home)
  assert.equal(record.features.intent, 'unknown')
  assert.equal(record.features.externalSystems, 20)
  assert.equal(record.recommendation.workflow, 'unknown')
  assert.equal(record.recommendation.confidence, 0)
  assert.equal(record.recommendation.margin, 1)
  assert.equal(record.metrics.latencyMs, 0)
  assert.equal(record.metrics.usage.total, 0)
  assert.equal(record.errorCategory, 'unknown')
})

test('record enforces workflow consistency and conservative status', async t => {
  const home = await temporaryHome(t)

  const ineligible = sample()
  ineligible.eligibleCandidates = ['standard-openspec', 'anvil']
  ineligible.recommendation.workflow = 'spec-superflow'
  ineligible.recommendation.workflowProbabilities['standard-openspec'] = 0.35
  ineligible.recommendation.workflowProbabilities.anvil = 0.55
  ineligible.recommendation.workflowProbabilities['spec-superflow'] = 0.1
  let result = await run(home, ['record'], ineligible)
  assert.equal(result.code, 0, result.stderr)

  const contradictory = sample()
  contradictory.recommendation.changeNecessity = 'direct'
  contradictory.recommendation.workflow = 'anvil'
  contradictory.recommendation.classificationProbabilities.direct = 0.8
  contradictory.recommendation.classificationProbabilities['formal-workflow'] = 0.15
  contradictory.recommendation.classificationProbabilities['manual-review'] = 0.05
  result = await run(home, ['record'], contradictory)
  assert.equal(result.code, 0, result.stderr)

  const escaped = sample()
  escaped.recommendation.escape = true
  result = await run(home, ['record'], escaped)
  assert.equal(result.code, 0, result.stderr)

  const incomplete = sample()
  delete incomplete.recommendation.workflowProbabilities.ask_user
  result = await run(home, ['record'], incomplete)
  assert.equal(result.code, 0, result.stderr)

  const failedRequirement = sample()
  failedRequirement.recommendation.requirementChecks.safetyCompatible = false
  result = await run(home, ['record'], failedRequirement)
  assert.equal(result.code, 0, result.stderr)

  const records = await storedRecords(home)
  assert.equal(records[0].recommendation.workflow, 'unknown')
  assert.equal(records[0].recommendation.status, 'needs-review')
  assert.equal(records[1].recommendation.workflow, 'direct')
  assert.equal(records[1].recommendation.status, 'auto-candidate')
  for (const record of records.slice(2)) assert.equal(record.recommendation.status, 'needs-review')
})

test('retention enforces count and byte bounds with complete JSONL records', async t => {
  const home = await temporaryHome(t)
  const env = {
    DSH_JEV_WORKFLOW_ROUTER_MAX_COUNT: '3',
    DSH_JEV_WORKFLOW_ROUTER_MAX_BYTES: '2200',
  }
  for (let index = 0; index < 12; index += 1) {
    const result = await run(home, ['record'], sample(index), env)
    assert.equal(result.code, 0, result.stderr)
  }
  const fileStat = await stat(recordsPath(home))
  assert.ok(fileStat.size <= 2200, fileStat.size)
  const records = await storedRecords(home)
  assert.ok(records.length <= 3, records.length)
  assert.ok(records.length > 0)
})

test('concurrent record calls do not lose writes', async t => {
  const home = await temporaryHome(t)
  const calls = Array.from({ length: 16 }, (_, index) => run(home, ['record'], sample(index), {
    DSH_JEV_WORKFLOW_ROUTER_MAX_COUNT: '100',
    DSH_JEV_WORKFLOW_ROUTER_MAX_BYTES: '1048576',
  }))
  const results = await Promise.all(calls)
  for (const result of results) assert.equal(result.code, 0, result.stderr)
  const records = await storedRecords(home)
  assert.equal(records.length, 16)
  assert.equal(new Set(records.map(record => record.observationId)).size, 16)
})

test('corrupt JSONL is ignored and does not block record or summary', async t => {
  const home = await temporaryHome(t)
  await mkdir(join(home, 'state', 'jev-workflow-router'), { recursive: true })
  await writeFile(recordsPath(home), '{not-json}\n{"schemaVersion":99}\n', 'utf8')

  const summaryBefore = await run(home, ['summary'])
  assert.equal(summaryBefore.code, 0, summaryBefore.stderr)
  assert.equal(JSON.parse(summaryBefore.stdout).records, 0)

  const recorded = await run(home, ['record'], sample())
  assert.equal(recorded.code, 0, recorded.stderr)
  const summaryAfter = await run(home, ['summary'])
  assert.equal(JSON.parse(summaryAfter.stdout).records, 1)
})

test('disabled mode prevents record, label, and clear writes', async t => {
  const home = await temporaryHome(t)
  const disabledEnv = { DSH_JEV_WORKFLOW_ROUTER_DISABLED: 'true' }
  const record = await run(home, ['record'], sample(), disabledEnv)
  assert.deepEqual(JSON.parse(record.stdout), { disabled: true, recorded: false })
  await assert.rejects(access(recordsPath(home)))

  const enabled = await run(home, ['record'], sample())
  const id = JSON.parse(enabled.stdout).observationId
  const before = await readFile(recordsPath(home), 'utf8')
  const label = await run(home, ['label', id, 'anvil', 'agent'], undefined, disabledEnv)
  const clear = await run(home, ['clear'], undefined, disabledEnv)
  assert.deepEqual(JSON.parse(label.stdout), { disabled: true, labelled: false })
  assert.deepEqual(JSON.parse(clear.stdout), { disabled: true, cleared: false })
  assert.equal(await readFile(recordsPath(home), 'utf8'), before)
})

test('label updates actual route only with a reliable closed source', async t => {
  const home = await temporaryHome(t)
  const recorded = await run(home, ['record'], sample())
  const id = JSON.parse(recorded.stdout).observationId

  const invalid = await run(home, ['label', id, 'direct', 'guessed'])
  assert.equal(invalid.code, 1)
  let [record] = await storedRecords(home)
  assert.equal(record.actualRoute, 'unknown')

  const labelled = await run(home, ['label', id, 'anvil', 'existing-change'])
  assert.equal(labelled.code, 0, labelled.stderr)
  assert.equal(JSON.parse(labelled.stdout).labelled, true)
  ;[record] = await storedRecords(home)
  assert.equal(record.actualRoute, 'anvil')
  assert.equal(record.overrideSource, 'existing-change')
})

test('summary is aggregate-only and clear removes records', async t => {
  const home = await temporaryHome(t)
  const first = await run(home, ['record'], sample(1))
  const second = await run(home, ['record'], sample(2))
  assert.equal(first.code, 0)
  assert.equal(second.code, 0)
  const firstId = JSON.parse(first.stdout).observationId
  assert.equal((await run(home, ['label', firstId, 'direct', 'user-explicit'])).code, 0)

  const result = await run(home, ['summary'])
  assert.equal(result.code, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.records, 2)
  assert.equal(summary.labelled, 1)
  assert.equal(summary.actualRoutes.direct, 1)
  assert.equal(summary.actualRoutes.unknown, 1)
  assert.equal(summary.overrideSources['user-explicit'], 1)
  assert.equal(summary.overrideSources.unknown, 1)
  assert.equal(result.stdout.includes(firstId), false)

  const cleared = await run(home, ['clear'])
  assert.deepEqual(JSON.parse(cleared.stdout), { disabled: false, cleared: true, removed: true })
  await assert.rejects(access(recordsPath(home)))
})
