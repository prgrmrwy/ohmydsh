#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'

const SCHEMA_VERSION = 1
const ROUTER_VERSION = 1
const CANDIDATE_CATALOG_VERSION = 1
const DEFAULT_MAX_COUNT = 1_000
const DEFAULT_MAX_BYTES = 1_048_576
const MIN_MAX_BYTES = 1_024
const MAX_MAX_BYTES = 16_777_216
const MAX_INPUT_BYTES = 65_536
const LOCK_WAIT_MS = 2_000
const LOCK_STALE_MS = 30_000
const REPORT_VERSION = 1
const PHASE_2_THRESHOLDS = {
  labelled: 100,
  distinctWorkingDays: 10,
  routeLabels: 15,
  highCostCategoryLabels: 10,
  weightedCostPerLabelled: 0.75,
  needsReviewRate: 0.35,
  providerFailureRate: 0.05,
  p50LatencyMs: 1_500,
  p95LatencyMs: 5_000,
}

const ROUTES = ['direct', 'standard-openspec', 'anvil', 'spec-superflow']
const FORMAL_ROUTES = ROUTES.filter(route => route !== 'direct')
const ACTUAL_ROUTES = [...ROUTES, 'unknown']
const LABEL_SOURCES = ['user-explicit', 'agent', 'existing-change']
const OVERRIDE_SOURCES = [...LABEL_SOURCES, 'unknown']
const INTENTS = [
  'explanation',
  'research',
  'bugfix',
  'feature',
  'maintenance',
  'migration',
  'security',
  'unknown',
]
const SCOPES = ['none', 'small', 'single-module', 'multi-module', 'unknown']
const SAFETY_RISKS = ['none', 'low', 'high', 'unknown']
const MIGRATION_RISKS = ['none', 'reversible', 'irreversible', 'unknown']
const CHANGE_NECESSITY = ['direct', 'formal-workflow', 'unknown']
const STATUSES = ['auto-candidate', 'needs-review', 'unavailable']
const ERROR_CATEGORIES = [
  'none',
  'missing-credential',
  'unauthorized',
  'rate-limited',
  'provider-5xx',
  'network',
  'timeout',
  'cancelled',
  'malformed-response',
  'unknown',
]
const CLASSIFICATION_PROBABILITY_KEYS = ['direct', 'formal-workflow', 'manual-review']
const WORKFLOW_PROBABILITY_KEYS = [
  'standard-openspec',
  'anvil',
  'spec-superflow',
  'ask_user',
  'investigate',
  'none',
]
const WORKFLOW_ESCAPE_KEYS = ['ask_user', 'investigate', 'none']
const REQUIREMENT_KEYS = [
  'eligibleChoice',
  'completeProbabilities',
  'confidenceMet',
  'marginMet',
  'safetyCompatible',
]

function disabled() {
  return /^(?:1|true|yes|on)$/iu.test(process.env.DSH_JEV_WORKFLOW_ROUTER_DISABLED ?? '')
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

function limits() {
  return {
    maxCount: boundedInteger(
      process.env.DSH_JEV_WORKFLOW_ROUTER_MAX_COUNT,
      DEFAULT_MAX_COUNT,
      1,
      100_000,
    ),
    maxBytes: boundedInteger(
      process.env.DSH_JEV_WORKFLOW_ROUTER_MAX_BYTES,
      DEFAULT_MAX_BYTES,
      MIN_MAX_BYTES,
      MAX_MAX_BYTES,
    ),
  }
}

function paths() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const stateDir = join(dshHome, 'state', 'jev-workflow-router')
  return {
    stateDir,
    recordsFile: join(stateDir, 'records.v1.jsonl'),
    lockDir: join(stateDir, '.records.lock'),
  }
}

function enumValue(value, allowed, fallback = 'unknown') {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function bool(value) {
  return value === true
}

function finite(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}

function finiteInteger(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.trunc(finite(value, fallback, minimum, maximum))
}

function newObservationId() {
  return randomUUID()
}

function normalizeFeatures(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return {
    intent: enumValue(source.intent, INTENTS),
    scope: enumValue(source.scope, SCOPES),
    behaviorChange: bool(source.behaviorChange),
    persistence: bool(source.persistence),
    concurrency: bool(source.concurrency),
    existingChange: bool(source.existingChange),
    safetyGateConflict: bool(source.safetyGateConflict),
    externalSystems: finiteInteger(source.externalSystems, 0, 0, 20),
    safetyRisk: enumValue(source.safetyRisk, SAFETY_RISKS),
    migrationRisk: enumValue(source.migrationRisk, MIGRATION_RISKS),
    explicitRoute: enumValue(source.explicitRoute, ACTUAL_ROUTES),
  }
}

function normalizeEligibleCandidates(input) {
  if (!Array.isArray(input)) return ['standard-openspec']
  const candidates = ROUTES.filter(route => input.includes(route))
  if (!candidates.includes('standard-openspec')) candidates.push('standard-openspec')
  return candidates
}

function normalizeProbabilityMap(input, keys) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return Object.fromEntries(keys.map(key => [key, finite(source[key], 0, 0, 1)]))
}

function completeDistribution(source, normalized, keys) {
  return keys.every(key => (
    source
    && typeof source === 'object'
    && typeof source[key] === 'number'
    && Number.isFinite(source[key])
    && source[key] >= 0
    && source[key] <= 1
  )) && Math.abs(keys.reduce((sum, key) => sum + normalized[key], 0) - 1) <= 0.001
}

function normalizeRequirementChecks(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  return Object.fromEntries(REQUIREMENT_KEYS.map(key => [key, bool(source[key])]))
}

function normalizeRecord(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const recommendation = source.recommendation && typeof source.recommendation === 'object'
    && !Array.isArray(source.recommendation) ? source.recommendation : {}
  const metrics = source.metrics && typeof source.metrics === 'object' && !Array.isArray(source.metrics)
    ? source.metrics : {}
  const usage = metrics.usage && typeof metrics.usage === 'object' && !Array.isArray(metrics.usage)
    ? metrics.usage : {}
  const eligibleCandidates = normalizeEligibleCandidates(source.eligibleCandidates)
  const changeNecessity = enumValue(recommendation.changeNecessity, CHANGE_NECESSITY)
  const requestedWorkflow = enumValue(recommendation.workflow, ACTUAL_ROUTES)
  const workflow = changeNecessity === 'direct'
    ? 'direct'
    : changeNecessity === 'formal-workflow'
      && requestedWorkflow !== 'direct'
      && eligibleCandidates.includes(requestedWorkflow)
      ? requestedWorkflow
      : 'unknown'
  const classificationSource = recommendation.classificationProbabilities
  const workflowSource = recommendation.workflowProbabilities
  const classificationProbabilities = normalizeProbabilityMap(
    classificationSource,
    CLASSIFICATION_PROBABILITY_KEYS,
  )
  const workflowProbabilities = normalizeProbabilityMap(workflowSource, WORKFLOW_PROBABILITY_KEYS)
  const eligibleWorkflowKeys = [
    ...eligibleCandidates.filter(candidate => candidate !== 'direct'),
    ...WORKFLOW_ESCAPE_KEYS,
  ]
  const completeClassification = completeDistribution(
    classificationSource,
    classificationProbabilities,
    CLASSIFICATION_PROBABILITY_KEYS,
  )
  const completeWorkflow = changeNecessity !== 'formal-workflow' || completeDistribution(
    workflowSource,
    workflowProbabilities,
    eligibleWorkflowKeys,
  )
  const completeProbabilities = completeClassification && completeWorkflow
  const requirementChecks = normalizeRequirementChecks(recommendation.requirementChecks)
  const confidenceValid = typeof recommendation.confidence === 'number'
    && Number.isFinite(recommendation.confidence)
    && recommendation.confidence >= 0
    && recommendation.confidence <= 1
  const marginValid = typeof recommendation.margin === 'number'
    && Number.isFinite(recommendation.margin)
    && recommendation.margin >= 0
    && recommendation.margin <= 1
  const escape = bool(recommendation.escape)
  const errorCategory = enumValue(source.errorCategory, ERROR_CATEGORIES, 'unknown')
  const conservativePass = workflow !== 'unknown'
    && completeProbabilities
    && confidenceValid
    && marginValid
    && !escape
    && errorCategory === 'none'
    && Object.values(requirementChecks).every(Boolean)
  const requestedStatus = enumValue(recommendation.status, STATUSES, 'needs-review')
  const status = requestedStatus === 'auto-candidate' && conservativePass
    ? 'auto-candidate'
    : requestedStatus === 'unavailable'
      ? 'unavailable'
      : 'needs-review'

  return {
    schemaVersion: SCHEMA_VERSION,
    routerVersion: ROUTER_VERSION,
    candidateCatalogVersion: CANDIDATE_CATALOG_VERSION,
    observationId: newObservationId(),
    recordedAt: new Date().toISOString(),
    features: normalizeFeatures(source.features),
    eligibleCandidates,
    recommendation: {
      changeNecessity,
      workflow,
      classificationProbabilities,
      workflowProbabilities,
      confidence: finite(recommendation.confidence, 0, 0, 1),
      margin: finite(recommendation.margin, 0, 0, 1),
      escape,
      requirementChecks,
      status,
    },
    metrics: {
      latencyMs: finiteInteger(metrics.latencyMs, 0, 0, 60_000),
      usage: {
        input: finiteInteger(usage.input, 0, 0, 10_000_000),
        output: finiteInteger(usage.output, 0, 0, 10_000_000),
        total: finiteInteger(usage.total, 0, 0, 20_000_000),
      },
    },
    errorCategory,
    actualRoute: 'unknown',
    overrideSource: 'unknown',
  }
}

function normalizeStoredRecord(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schemaVersion !== SCHEMA_VERSION
    || typeof value.observationId !== 'string'
    || !/^[a-f0-9-]{8,64}$/u.test(value.observationId)
    || !ACTUAL_ROUTES.includes(value.actualRoute)
    || !OVERRIDE_SOURCES.includes(value.overrideSource)
  ) return null

  const normalized = normalizeRecord(value)
  normalized.observationId = value.observationId
  const recordedAt = new Date(value.recordedAt)
  normalized.recordedAt = Number.isFinite(recordedAt.getTime())
    ? recordedAt.toISOString()
    : normalized.recordedAt
  normalized.actualRoute = value.actualRoute
  normalized.overrideSource = value.overrideSource
  return normalized
}

async function readRecords(recordsFile) {
  let text
  try {
    text = await readFile(recordsFile, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const records = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = normalizeStoredRecord(JSON.parse(line))
      if (parsed) records.push(parsed)
    } catch {
      // Corrupt or partial lines are intentionally ignored.
    }
  }
  return records
}

function encodeRecords(records) {
  return records.length === 0 ? '' : `${records.map(record => JSON.stringify(record)).join('\n')}\n`
}

function trimRecords(records, { maxCount, maxBytes }) {
  const retained = records.slice(-maxCount)
  while (retained.length > 0 && Buffer.byteLength(encodeRecords(retained)) > maxBytes) {
    retained.shift()
  }
  return retained
}

async function atomicWrite(recordsFile, content) {
  await mkdir(dirname(recordsFile), { recursive: true, mode: 0o700 })
  const temporary = `${recordsFile}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, recordsFile)
  } finally {
    await unlink(temporary).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function acquireLock(stateDir, lockDir) {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const deadline = Date.now() + LOCK_WAIT_MS
  while (true) {
    try {
      await mkdir(lockDir, { mode: 0o700 })
      await writeFile(join(lockDir, 'owner'), `${process.pid}\n`, { mode: 0o600 })
      return async () => rm(lockDir, { recursive: true, force: true })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        const lockStat = await stat(lockDir)
        if (Date.now() - lockStat.mtimeMs > LOCK_STALE_MS) {
          await rm(lockDir, { recursive: true, force: true })
          continue
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue
        throw statError
      }
      if (Date.now() >= deadline) throw new Error('recorder lock timeout')
      await delay(20)
    }
  }
}

async function withLock(action) {
  const { stateDir, lockDir } = paths()
  const release = await acquireLock(stateDir, lockDir)
  try {
    return await action(paths())
  } finally {
    await release()
  }
}

async function readStdin() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_INPUT_BYTES) throw new Error('input exceeds 65536 bytes')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() ? JSON.parse(text) : {}
}

async function recordCommand() {
  if (disabled()) return { disabled: true, recorded: false }
  const input = await readStdin()
  const record = normalizeRecord(input)
  await withLock(async ({ recordsFile }) => {
    const records = await readRecords(recordsFile)
    records.push(record)
    await atomicWrite(recordsFile, encodeRecords(trimRecords(records, limits())))
  })
  return { disabled: false, recorded: true, observationId: record.observationId }
}

async function labelCommand(observationId, actualRoute, source) {
  if (disabled()) return { disabled: true, labelled: false }
  if (!/^[a-f0-9-]{8,64}$/u.test(observationId ?? '')) throw new Error('invalid observation id')
  if (!ROUTES.includes(actualRoute)) throw new Error('invalid actual route')
  if (!LABEL_SOURCES.includes(source)) throw new Error('invalid label source')

  let labelled = false
  await withLock(async ({ recordsFile }) => {
    const records = await readRecords(recordsFile)
    const target = [...records].reverse().find(record => record.observationId === observationId)
    if (target) {
      target.actualRoute = actualRoute
      target.overrideSource = source
      labelled = true
      await atomicWrite(recordsFile, encodeRecords(trimRecords(records, limits())))
    }
  })
  return { disabled: false, labelled, observationId }
}

function increment(object, key) {
  object[key] = (object[key] ?? 0) + 1
}

async function summaryCommand() {
  const records = await readRecords(paths().recordsFile)
  const summary = {
    schemaVersion: SCHEMA_VERSION,
    records: records.length,
    statuses: {},
    recommendations: {},
    actualRoutes: {},
    overrideSources: {},
    errors: {},
    labelled: 0,
  }
  for (const record of records) {
    increment(summary.statuses, enumValue(record.recommendation?.status, STATUSES, 'needs-review'))
    increment(summary.recommendations, enumValue(record.recommendation?.workflow, ACTUAL_ROUTES))
    increment(summary.actualRoutes, enumValue(record.actualRoute, ACTUAL_ROUTES))
    increment(summary.overrideSources, enumValue(record.overrideSource, OVERRIDE_SOURCES))
    increment(summary.errors, enumValue(record.errorCategory, ERROR_CATEGORIES, 'unknown'))
    if (record.actualRoute !== 'unknown') summary.labelled += 1
  }
  return summary
}

function emptyConfusionMatrix() {
  return Object.fromEntries(ROUTES.map(actual => [
    actual,
    Object.fromEntries(ROUTES.map(recommended => [recommended, 0])),
  ]))
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
}

function candidateSetKey(record) {
  return ROUTES.filter(route => record.eligibleCandidates.includes(route)).join('|')
}

function isAutoCandidate(record) {
  return record.recommendation.status === 'auto-candidate'
    && ROUTES.includes(record.recommendation.workflow)
}

// Cost rules use deterministic first-match precedence. Authority conflicts and
// high-risk misses are evaluated before general route mismatch rules. Because
// every formal->direct miss is cost 10, the gate's later standard->direct (6)
// and spec-superflow->direct (5) entries are intentionally superseded.
function recommendationCost(record) {
  if (!isAutoCandidate(record)) return 0
  const actual = record.actualRoute
  const recommended = record.recommendation.workflow
  if (actual === 'unknown' || actual === recommended) return 0
  if (record.features.existingChange) return 10
  if (record.features.explicitRoute !== 'unknown' && record.features.explicitRoute !== recommended) {
    return 10
  }
  if (actual === 'anvil' && (recommended === 'direct' || recommended === 'spec-superflow')) {
    return 10
  }
  if (FORMAL_ROUTES.includes(actual) && recommended === 'direct') return 10
  if (actual === 'direct' && FORMAL_ROUTES.includes(recommended)) return 2
  if (FORMAL_ROUTES.includes(actual) && FORMAL_ROUTES.includes(recommended)) return 3
  return 0
}

function newAggregate() {
  return {
    total: 0,
    labelled: 0,
    unknownLabels: 0,
    autoCandidateRecommendations: 0,
    needsReview: 0,
    unavailable: 0,
    providerFailures: 0,
    weightedCost: 0,
    highCostMisses: 0,
  }
}

function addToAggregate(aggregate, record) {
  aggregate.total += 1
  const labelled = record.actualRoute !== 'unknown'
  aggregate.labelled += labelled ? 1 : 0
  aggregate.unknownLabels += labelled ? 0 : 1
  aggregate.autoCandidateRecommendations += isAutoCandidate(record) ? 1 : 0
  aggregate.needsReview += record.recommendation.status === 'needs-review' ? 1 : 0
  aggregate.unavailable += record.recommendation.status === 'unavailable' ? 1 : 0
  aggregate.providerFailures += record.errorCategory !== 'none' ? 1 : 0
  if (labelled) {
    const cost = recommendationCost(record)
    aggregate.weightedCost += cost
    aggregate.highCostMisses += cost === 10 ? 1 : 0
  }
}

function groupedAggregates(records, keyOf, initialKeys = []) {
  const groups = Object.fromEntries(initialKeys.map(key => [key, newAggregate()]))
  for (const record of records) {
    const key = String(keyOf(record))
    groups[key] ??= newAggregate()
    addToAggregate(groups[key], record)
  }
  return groups
}

function labelledHighCostCategories(records) {
  const counts = {
    security: 0,
    'migration-persistence': 0,
    concurrency: 0,
    'existing-change': 0,
    'explicit-selection': 0,
  }
  for (const record of records) {
    if (record.actualRoute === 'unknown') continue
    if (
      record.features.intent === 'security'
      || record.features.safetyRisk === 'high'
      || record.features.safetyGateConflict
    ) counts.security += 1
    if (
      record.features.intent === 'migration'
      || record.features.persistence
      || record.features.migrationRisk !== 'none'
    ) counts['migration-persistence'] += 1
    if (record.features.concurrency) counts.concurrency += 1
    if (record.features.existingChange) counts['existing-change'] += 1
    if (record.features.explicitRoute !== 'unknown') counts['explicit-selection'] += 1
  }
  return counts
}

function coverageWarnings({ labelled, distinctWorkingDays, routeLabels, highCostCategories }) {
  const warnings = [
    {
      code: 'language-coverage-unavailable',
      metric: 'language',
      actual: null,
      required: { chinese: 30, english: 20 },
    },
    {
      code: 'sample-provenance-unavailable',
      metric: 'sample-provenance',
      actual: null,
      required: 'synthetic-and-real-vibe-identifiable',
    },
  ]
  if (labelled < PHASE_2_THRESHOLDS.labelled) warnings.push({
    code: 'labelled-observations-below-threshold',
    metric: 'labelled',
    actual: labelled,
    required: PHASE_2_THRESHOLDS.labelled,
  })
  if (distinctWorkingDays < PHASE_2_THRESHOLDS.distinctWorkingDays) warnings.push({
    code: 'working-days-below-threshold',
    metric: 'distinctWorkingDays',
    actual: distinctWorkingDays,
    required: PHASE_2_THRESHOLDS.distinctWorkingDays,
  })
  for (const route of ROUTES) {
    if (routeLabels[route] < PHASE_2_THRESHOLDS.routeLabels) warnings.push({
      code: 'actual-route-coverage-below-threshold',
      metric: route,
      actual: routeLabels[route],
      required: PHASE_2_THRESHOLDS.routeLabels,
    })
  }
  for (const [category, count] of Object.entries(highCostCategories)) {
    if (count < PHASE_2_THRESHOLDS.highCostCategoryLabels) warnings.push({
      code: 'high-cost-category-coverage-below-threshold',
      metric: category,
      actual: count,
      required: PHASE_2_THRESHOLDS.highCostCategoryLabels,
    })
  }
  return warnings
}

async function reportCommand() {
  const records = await readRecords(paths().recordsFile)
  const overall = newAggregate()
  const confusionMatrix = emptyConfusionMatrix()
  const workingDays = new Set()
  const versions = {
    schemaVersion: {},
    routerVersion: {},
    candidateCatalogVersion: {},
  }
  const eligibleCandidateSets = {}
  const routeLabels = Object.fromEntries(ROUTES.map(route => [route, 0]))
  const usageTotals = { input: 0, output: 0, total: 0 }
  const latencies = []

  for (const record of records) {
    addToAggregate(overall, record)
    workingDays.add(record.recordedAt.slice(0, 10))
    increment(versions.schemaVersion, String(record.schemaVersion))
    increment(versions.routerVersion, String(record.routerVersion))
    increment(versions.candidateCatalogVersion, String(record.candidateCatalogVersion))
    increment(eligibleCandidateSets, candidateSetKey(record))
    latencies.push(record.metrics.latencyMs)
    for (const key of Object.keys(usageTotals)) usageTotals[key] += record.metrics.usage[key]

    if (record.actualRoute !== 'unknown') {
      routeLabels[record.actualRoute] += 1
      if (isAutoCandidate(record)) {
        confusionMatrix[record.actualRoute][record.recommendation.workflow] += 1
      }
    }
  }

  const highCostCategories = labelledHighCostCategories(records)
  const warnings = coverageWarnings({
    labelled: overall.labelled,
    distinctWorkingDays: workingDays.size,
    routeLabels,
    highCostCategories,
  })
  const meanUsage = Object.fromEntries(Object.entries(usageTotals).map(([key, value]) => [
    key,
    records.length === 0 ? null : value / records.length,
  ]))

  return {
    reportVersion: REPORT_VERSION,
    dataset: {
      total: overall.total,
      labelled: overall.labelled,
      unknownLabels: overall.unknownLabels,
      distinctWorkingDays: workingDays.size,
      languageProxy: {
        availability: 'unavailable',
        reason: 'language-not-recorded-and-must-not-be-inferred',
      },
      versions,
      eligibleCandidateSets,
      actualRouteLabels: routeLabels,
      highCostCategoryLabels: highCostCategories,
    },
    recommendations: {
      autoCandidateOnly: true,
      autoCandidateCount: overall.autoCandidateRecommendations,
      needsReviewCount: overall.needsReview,
      unavailableCount: overall.unavailable,
      confusionMatrix: {
        orientation: 'actual-to-recommended',
        routes: ROUTES,
        counts: confusionMatrix,
      },
    },
    cost: {
      precedence: [
        'non-auto-candidate-zero',
        'correct-zero',
        'existing-change-different-10',
        'explicit-route-different-10',
        'anvil-to-direct-or-spec-superflow-10',
        'formal-to-direct-10',
        'direct-to-formal-2',
        'other-formal-mismatch-3',
      ],
      weightedTotal: overall.weightedCost,
      weightedPerLabelled: overall.labelled === 0 ? null : overall.weightedCost / overall.labelled,
      highCostMisses: overall.highCostMisses,
      needsReviewCost: 0,
    },
    quality: {
      needsReviewRate: records.length === 0 ? 0 : overall.needsReview / records.length,
      providerFailureRate: records.length === 0 ? 0 : overall.providerFailures / records.length,
      providerFailures: overall.providerFailures,
      latencyMs: {
        method: 'nearest-rank',
        p50: nearestRank(latencies, 0.5),
        p95: nearestRank(latencies, 0.95),
      },
      usage: {
        totals: usageTotals,
        means: meanUsage,
      },
      estimatedExternalCost: null,
      estimatedExternalCostReason: 'pricing-model-unavailable',
    },
    breakdowns: {
      intentCategory: groupedAggregates(records, record => record.features.intent, INTENTS),
      actualRoute: groupedAggregates(records, record => record.actualRoute, ACTUAL_ROUTES),
      routerVersion: groupedAggregates(records, record => record.routerVersion),
      candidateSet: groupedAggregates(records, candidateSetKey),
    },
    coverage: {
      phase2Admission: 'not-established',
      thresholds: PHASE_2_THRESHOLDS,
      warnings,
    },
  }
}

async function clearCommand() {
  if (disabled()) return { disabled: true, cleared: false }
  let removed = false
  await withLock(async ({ recordsFile }) => {
    await unlink(recordsFile).then(() => { removed = true }).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  })
  return { disabled: false, cleared: true, removed }
}

function usage() {
  return 'usage: recorder.mjs record | label OBSERVATION_ID ACTUAL_ROUTE SOURCE | summary | report | clear'
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  let result
  switch (command) {
    case 'record':
      if (args.length !== 0) throw new Error(usage())
      result = await recordCommand()
      break
    case 'label':
      if (args.length !== 3) throw new Error(usage())
      result = await labelCommand(...args)
      break
    case 'summary':
      if (args.length !== 0) throw new Error(usage())
      result = await summaryCommand()
      break
    case 'report':
      if (args.length !== 0) throw new Error(usage())
      result = await reportCommand()
      break
    case 'clear':
      if (args.length !== 0) throw new Error(usage())
      result = await clearCommand()
      break
    default:
      throw new Error(usage())
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

main().catch(error => {
  process.stderr.write(`jev-workflow-router recorder: ${error.message}\n`)
  process.exitCode = 1
})
