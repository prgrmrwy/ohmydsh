import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const recorder = new URL('../skills/jev-workflow-router/recorder.mjs', import.meta.url)
const ROUTES = ['direct', 'standard-openspec', 'anvil', 'spec-superflow']

function run(home, args, input) {
  const result = spawnSync(process.execPath, [recorder.pathname, ...args], {
    encoding: 'utf8', env: { ...process.env, DSH_HOME: home },
    input: input === undefined ? undefined : JSON.stringify(input),
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function recommendation(route, status = 'auto-candidate') {
  const formal = route !== 'direct'
  const workflowProbabilities = { 'standard-openspec': 0, anvil: 0, 'spec-superflow': 0, ask_user: 0, investigate: 0, none: 0 }
  if (formal) { workflowProbabilities[route] = 0.9; workflowProbabilities.ask_user = 0.05; workflowProbabilities.investigate = 0.03; workflowProbabilities.none = 0.02 }
  return {
    changeNecessity: formal ? 'formal-workflow' : 'direct', workflow: route,
    classificationProbabilities: formal ? { direct: 0.05, 'formal-workflow': 0.9, 'manual-review': 0.05 } : { direct: 0.9, 'formal-workflow': 0.05, 'manual-review': 0.05 },
    workflowProbabilities, confidence: 0.9, margin: 0.7, escape: false, status,
    requirementChecks: { eligibleChoice: true, completeProbabilities: true, confidenceMet: true, marginMet: true, safetyCompatible: true },
  }
}

function features(extra = {}) {
  return { intent: 'feature', scope: 'single-module', behaviorChange: true, persistence: false, concurrency: false, existingChange: false, safetyGateConflict: false, externalSystems: 0, safetyRisk: 'low', migrationRisk: 'none', explicitRoute: 'unknown', ...extra }
}

async function add(home, { actual, recommended, status, errorCategory = 'none', latencyMs, usage, feature = {} }) {
  const output = run(home, ['record'], {
    features: features(feature), eligibleCandidates: ROUTES,
    recommendation: recommendation(recommended, status),
    metrics: { latencyMs, usage }, errorCategory,
    rawProviderError: 'SECRET https://private.example user@example.com /private/path',
  })
  if (actual) run(home, ['label', output.observationId, actual, feature.existingChange ? 'existing-change' : feature.explicitRoute && feature.explicitRoute !== 'unknown' ? 'user-explicit' : 'agent'])
}

test('report emits aggregate confusion, cost, reliability, latency and coverage only', async t => {
  const home = await mkdtemp(join(tmpdir(), 'jev-report-')); t.after(() => rm(home, { recursive: true, force: true }))
  await add(home, { actual: 'direct', recommended: 'standard-openspec', latencyMs: 10, usage: { input: 2, output: 3, total: 5 } })
  await add(home, { actual: 'standard-openspec', recommended: 'direct', latencyMs: 20, usage: { input: 4, output: 5, total: 9 } })
  await add(home, { actual: 'anvil', recommended: 'spec-superflow', latencyMs: 30, usage: { input: 6, output: 7, total: 13 }, feature: { intent: 'security', safetyRisk: 'high' } })
  await add(home, { actual: 'standard-openspec', recommended: 'anvil', latencyMs: 40, usage: { input: 8, output: 9, total: 17 }, feature: { existingChange: true } })
  await add(home, { actual: 'spec-superflow', recommended: 'anvil', status: 'needs-review', errorCategory: 'timeout', latencyMs: 50, usage: { input: 10, output: 11, total: 21 } })
  await add(home, { recommended: 'direct', latencyMs: 60, usage: { input: 12, output: 13, total: 25 } })
  const report = run(home, ['report'])
  assert.equal(report.dataset.total, 6); assert.equal(report.dataset.labelled, 5); assert.equal(report.dataset.unknownLabels, 1)
  assert.equal(report.recommendations.confusionMatrix.counts.direct['standard-openspec'], 1)
  assert.equal(report.recommendations.confusionMatrix.counts['standard-openspec'].direct, 1)
  assert.equal(report.recommendations.confusionMatrix.counts.anvil['spec-superflow'], 1)
  assert.equal(report.cost.weightedTotal, 28); assert.equal(report.cost.weightedPerLabelled, 5.6); assert.equal(report.cost.highCostMisses, 2)
  assert.equal(report.cost.needsReviewCost, 0); assert.equal(report.quality.needsReviewRate, 1 / 6); assert.equal(report.quality.providerFailureRate, 1 / 6)
  assert.deepEqual(report.quality.latencyMs, { method: 'nearest-rank', p50: 30, p95: 60 })
  assert.deepEqual(report.quality.usage.totals, { input: 42, output: 48, total: 90 })
  assert.equal(report.quality.estimatedExternalCost, null)
  assert.equal(report.dataset.languageProxy.availability, 'unavailable')
  assert.equal(report.coverage.phase2Admission, 'not-established')
  assert.ok(report.coverage.warnings.some(w => w.code === 'language-coverage-unavailable'))
  assert.ok(report.coverage.warnings.some(w => w.code === 'weighted-cost-above-threshold'))
  assert.ok(!report.coverage.warnings.some(w => w.code === 'needs-review-rate-above-threshold'))
  assert.ok(report.coverage.warnings.some(w => w.code === 'provider-failure-rate-above-threshold'))
  assert.ok(report.coverage.warnings.some(w => w.code === 'high-cost-misses-present'))
  const text = JSON.stringify(report)
  assert.doesNotMatch(text, /SECRET|private\.example|user@example|private\/path|observationId|recordedAt/)
})

test('quality warnings include needs-review threshold breaches', async t => {
  const home = await mkdtemp(join(tmpdir(), 'jev-report-review-rate-')); t.after(() => rm(home, { recursive: true, force: true }))
  await add(home, { actual: 'standard-openspec', recommended: 'standard-openspec', status: 'needs-review', latencyMs: 1, usage: {} })
  const report = run(home, ['report'])
  assert.equal(report.quality.needsReviewRate, 1)
  assert.ok(report.coverage.warnings.some(w => w.code === 'needs-review-rate-above-threshold'))
})

test('every pre-registered misroute cost row is reachable with deterministic precedence', async t => {
  const home = await mkdtemp(join(tmpdir(), 'jev-report-costs-')); t.after(() => rm(home, { recursive: true, force: true }))
  await add(home, { actual: 'standard-openspec', recommended: 'direct', latencyMs: 1, usage: {} })
  await add(home, { actual: 'spec-superflow', recommended: 'direct', latencyMs: 1, usage: {} })
  await add(home, { actual: 'anvil', recommended: 'direct', latencyMs: 1, usage: {} })
  await add(home, { actual: 'direct', recommended: 'anvil', latencyMs: 1, usage: {} })
  await add(home, { actual: 'standard-openspec', recommended: 'anvil', latencyMs: 1, usage: {} })
  await add(home, { actual: 'standard-openspec', recommended: 'direct', latencyMs: 1, usage: {}, feature: { existingChange: true } })
  await add(home, { actual: 'spec-superflow', recommended: 'direct', latencyMs: 1, usage: {}, feature: { explicitRoute: 'spec-superflow' } })
  const report = run(home, ['report'])
  assert.equal(report.cost.weightedTotal, 46) // 6 + 5 + 10 + 2 + 3 + 10 + 10
  assert.equal(report.cost.highCostMisses, 3)
  assert.deepEqual(report.cost.precedence.slice(2), [
    'existing-change-different-10',
    'explicit-route-different-10',
    'anvil-to-direct-or-spec-superflow-10',
    'standard-openspec-to-direct-6',
    'spec-superflow-to-direct-5',
    'formal-to-direct-fallback-10',
    'direct-to-formal-2',
    'other-formal-mismatch-3',
  ])
})

test('zero placeholder latency remains unavailable rather than claiming 0ms', async t => {
  const home = await mkdtemp(join(tmpdir(), 'jev-report-no-latency-')); t.after(() => rm(home, { recursive: true, force: true }))
  await add(home, { actual: 'standard-openspec', recommended: 'standard-openspec', latencyMs: 0, usage: {} })
  const report = run(home, ['report'])
  assert.deepEqual(report.quality.latencyMs, { method: 'nearest-rank', p50: null, p95: null })
  assert.ok(report.coverage.warnings.some(w => w.code === 'latency-coverage-unavailable'))
})

test('empty and corrupt record sets produce a valid conservative report', async t => {
  const home = await mkdtemp(join(tmpdir(), 'jev-report-empty-')); t.after(() => rm(home, { recursive: true, force: true }))
  let report = run(home, ['report'])
  assert.equal(report.dataset.total, 0); assert.equal(report.cost.weightedPerLabelled, null); assert.equal(report.quality.latencyMs.p50, null)
  const file = join(home, 'state', 'jev-workflow-router', 'records.v1.jsonl')
  await mkdir(join(home, 'state', 'jev-workflow-router'), { recursive: true })
  await writeFile(file, '{bad json}\n')
  report = run(home, ['report'])
  assert.equal(report.dataset.total, 0)
})
