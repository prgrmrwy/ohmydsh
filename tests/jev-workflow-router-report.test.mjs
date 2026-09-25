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
  assert.equal(report.cost.weightedTotal, 32); assert.equal(report.cost.weightedPerLabelled, 6.4); assert.equal(report.cost.highCostMisses, 3)
  assert.equal(report.cost.needsReviewCost, 0); assert.equal(report.quality.needsReviewRate, 1 / 6); assert.equal(report.quality.providerFailureRate, 1 / 6)
  assert.deepEqual(report.quality.latencyMs, { method: 'nearest-rank', p50: 30, p95: 60 })
  assert.deepEqual(report.quality.usage.totals, { input: 42, output: 48, total: 90 })
  assert.equal(report.quality.estimatedExternalCost, null)
  assert.equal(report.dataset.languageProxy.availability, 'unavailable')
  assert.equal(report.coverage.phase2Admission, 'not-established')
  assert.ok(report.coverage.warnings.some(w => w.code === 'language-coverage-unavailable'))
  const text = JSON.stringify(report)
  assert.doesNotMatch(text, /SECRET|private\.example|user@example|private\/path|observationId|recordedAt/)
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
