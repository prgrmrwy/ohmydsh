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
import {
  SESSION_LOG_REASONS,
  findSessionLog,
  parseSessionEvents,
  readSessionLogFile,
} from './session-log.mjs'

const SCHEMA_VERSION = 2
const LEGACY_SCHEMA_VERSION = 1
const ROUTER_VERSION = 1
const CANDIDATE_CATALOG_VERSION = 1
const DEFAULT_MAX_COUNT = 1_000
const DEFAULT_MAX_BYTES = 1_048_576
const MIN_MAX_BYTES = 1_024
const MAX_MAX_BYTES = 16_777_216
const MAX_INPUT_BYTES = 65_536
const LOCK_WAIT_MS = 2_000
const LOCK_STALE_MS = 30_000
const REPORT_VERSION = 2
// Advisory mode is approved; these are ongoing health thresholds, not admission
// gates. The former sample-count/workday/route-coverage admission gates are gone
// because their only sample source was this router itself, which made them
// unreachable by construction.
const HEALTH_THRESHOLDS = {
  mismatchRate: 0.35,
  providerFailureRate: 0.05,
  p50LatencyMs: 1_500,
  p95LatencyMs: 5_000,
}

const ROUTES = ['direct', 'standard-openspec', 'anvil', 'spec-superflow']
const FORMAL_ROUTES = ROUTES.filter(route => route !== 'direct')
const ACTUAL_ROUTES = [...ROUTES, 'unknown']
const LABEL_SOURCES = ['user-explicit', 'agent', 'existing-change']
const OVERRIDE_SOURCES = [...LABEL_SOURCES, 'unknown']
const SAMPLE_PROVENANCE = ['real-vibe', 'synthetic-fixture', 'unknown']
const LATENCY_AVAILABILITY = ['measured', 'unavailable']
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
const JEV_PROVIDERS = ['typesafe', 'openrouter', 'unknown']
const ERROR_CATEGORIES = [
  'none',
  'missing-credential',
  'unauthorized',
  'rate-limited',
  'region-blocked',
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

/**
 * The window that scopes which Jev tool calls belong to one observation.
 *
 * Both bounds are epoch milliseconds taken from the session event log itself, so
 * the recorder can select exactly the `tool/call`/`tool/result` pairs of this
 * judgement instead of guessing from wall-clock proximity. An unusable window
 * yields null and the record simply carries no window.
 */
function normalizeObservedWindow(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const from = source.from
  const to = source.to
  if (
    typeof from !== 'number' || !Number.isFinite(from) || from < 0
    || typeof to !== 'number' || !Number.isFinite(to) || to < 0
    || to < from
  ) return null
  return { from: Math.trunc(from), to: Math.trunc(to) }
}

// Long-running sequences are legitimate: a shadow/advisory call can span a slow
// provider retry or a stalled network. The previous ceiling silently rewrote
// anything above 60 000 ms to exactly 60 000 ms, which makes long-tail audits
// read a fabricated value. Keep the measured number and mark the overflow
// explicitly instead, so a reader can tell "measured 80 057 ms" from
// "clamped, real value unknown".
const LATENCY_STORAGE_CEILING = 3_600_000

const LATENCY_REASONS = [
  'no-session-id',
  'sessions-root-missing',
  'session-file-missing',
  'decode-failed',
  'no-matching-calls',
  'result-missing',
]

function normalizeLatency(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const availability = enumValue(source.availability, LATENCY_AVAILABILITY, 'unavailable')
  if (
    availability !== 'measured'
    || typeof source.milliseconds !== 'number'
    || !Number.isFinite(source.milliseconds)
    || source.milliseconds < 0
  ) {
    // An absent reason must stay absent: `enumValue` would default it to
    // 'unknown', which would look like a real (if unknown) diagnosis.
    const reason = typeof source.reason === 'string' && LATENCY_REASONS.includes(source.reason)
      ? source.reason
      : undefined
    return reason === undefined
      ? { availability: 'unavailable', milliseconds: null }
      : { availability: 'unavailable', milliseconds: null, reason }
  }
  const milliseconds = Math.trunc(source.milliseconds)
  if (milliseconds > LATENCY_STORAGE_CEILING) {
    return { availability: 'measured', milliseconds: LATENCY_STORAGE_CEILING, truncated: true }
  }
  // A stored sample that was clamped when written now sits exactly at the
  // ceiling and is in range, so re-deriving the flag from the value would erase
  // the fact on every read. Preserve the explicit marker instead; fresh input
  // simply omits it.
  return { availability: 'measured', milliseconds, truncated: source.truncated === true }
}

const MAX_JEV_CALLS = 2
const MAX_CALL_MESSAGE = 512
// Anchored upstream formats only (jev-mcp 0.14.5 / jev-agent-tools 0.2.1); never scan free text for numbers.
const FAILURE_PROVIDER_PATTERNS = [
  [/^OpenRouter decisions API /u, 'openrouter'],
  [/^TypeSafe API /u, 'typesafe'],
  [/^Jev provider (typesafe|openrouter):/u, null],
]
const HTTP_STATUS_PATTERNS = [
  /^OpenRouter decisions API (\d{3})\b/u,
  /^TypeSafe API HTTP (\d{3})\b/u,
  /^Jev provider \w+: .*\(HTTP (\d{3})\)$/u,
]

function validJevCalls(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_JEV_CALLS) return null
  const calls = []
  for (const call of value) {
    if (!call || typeof call !== 'object' || Array.isArray(call)) return null
    if (call.outcome === 'success' && ['ok', 'invalid-response'].includes(call.semantic)) {
      calls.push({ outcome: 'success', provider: enumValue(call.provider, JEV_PROVIDERS, 'unknown'), semantic: call.semantic })
    } else if (call.outcome === 'error' && typeof call.message === 'string') {
      calls.push({ outcome: 'error', message: call.message.slice(0, MAX_CALL_MESSAGE) })
    } else {
      return null
    }
  }
  return calls
}

function failureProvider(message) {
  for (const [pattern, provider] of FAILURE_PROVIDER_PATTERNS) {
    const match = pattern.exec(message)
    if (match) return provider ?? match[1]
  }
  return 'unknown'
}

function failureCategory(message) {
  for (const pattern of HTTP_STATUS_PATTERNS) {
    const match = pattern.exec(message)
    if (!match) continue
    const status = Number(match[1])
    if (status === 451) return 'region-blocked'
    if (status === 401 || status === 403) return 'unauthorized'
    if (status === 429) return 'rate-limited'
    if (status >= 500 && status <= 599) return 'provider-5xx'
    return 'unknown'
  }
  if (/^Jev request exceeded the \d+ms deadline/u.test(message) || /timed out|timeout/iu.test(message)) return 'timeout'
  if (/fetch failed|socket|ECONN|ENOTFOUND|network/u.test(message)) return 'network'
  return 'unknown'
}

/** Deterministic attribution from bounded call projections; raw messages never leave this function. */
function attributeJevCalls(rawCalls, suppliedCategory) {
  const calls = validJevCalls(rawCalls)
  if (!calls) return { jevProvider: 'unknown', errorCategory: suppliedCategory }
  const known = [...new Set(calls
    .map(call => call.outcome === 'success' ? call.provider : failureProvider(call.message))
    .filter(provider => provider !== 'unknown'))]
  const jevProvider = known.length === 1 ? known[0] : 'unknown'
  const failed = calls.find(call => call.outcome === 'error')
  if (failed) return { jevProvider, errorCategory: failureCategory(failed.message) }
  if (calls.some(call => call.semantic === 'invalid-response')) return { jevProvider, errorCategory: 'malformed-response' }
  return { jevProvider, errorCategory: suppliedCategory }
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
  const attribution = Object.hasOwn(source, 'jevCalls')
    ? attributeJevCalls(source.jevCalls, enumValue(source.errorCategory, ERROR_CATEGORIES, 'unknown'))
    : { jevProvider: enumValue(source.jevProvider, JEV_PROVIDERS, 'unknown'), errorCategory: enumValue(source.errorCategory, ERROR_CATEGORIES, 'unknown') }
  const errorCategory = attribution.errorCategory
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
    sampleProvenance: enumValue(source.sampleProvenance, SAMPLE_PROVENANCE),
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
      latency: normalizeLatency(metrics.latency),
      usage: {
        input: finiteInteger(usage.input, 0, 0, 10_000_000),
        output: finiteInteger(usage.output, 0, 0, 10_000_000),
        total: finiteInteger(usage.total, 0, 0, 20_000_000),
      },
    },
    // Bounds for the `latency` subcommand: which Jev tool calls belong to this
    // observation. Absent means the record did not ask for event-log timing.
    ...(normalizeObservedWindow(source.observedWindow) === null
      ? {}
      : { observedWindow: normalizeObservedWindow(source.observedWindow) }),
    errorCategory,
    jevProvider: attribution.jevProvider,
    actualRoute: 'unknown',
    overrideSource: 'unknown',
  }
}

function normalizeStoredRecord(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || ![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(value.schemaVersion)
    || typeof value.observationId !== 'string'
    || !/^[a-f0-9-]{8,64}$/u.test(value.observationId)
    || !ACTUAL_ROUTES.includes(value.actualRoute)
    || !OVERRIDE_SOURCES.includes(value.overrideSource)
  ) return null

  const normalized = normalizeRecord(value)
  normalized.schemaVersion = value.schemaVersion
  if (value.schemaVersion === LEGACY_SCHEMA_VERSION) {
    normalized.sampleProvenance = 'unknown'
    normalized.metrics.latency = typeof value.metrics?.latencyMs === 'number'
      && Number.isFinite(value.metrics.latencyMs)
      && value.metrics.latencyMs > 0
      ? normalizeLatency({ availability: 'measured', milliseconds: value.metrics.latencyMs })
      : { availability: 'unavailable', milliseconds: null }
  }
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
  return records.length === 0 ? '' : `${records.map(record => JSON.stringify({
    ...record,
    schemaVersion: SCHEMA_VERSION,
  })).join('\n')}\n`
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
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    // Node's parser message quotes input fragments; never echo them.
    throw new Error('invalid JSON input')
  }
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

/**
 * Pair Jev tool calls with their results inside a window and sum the elapsed ms.
 *
 * Timestamps come from the session event log, which records `tool/call` and
 * `tool/result` with millisecond precision. That is the transport actually
 * observed; asking the agent to diff two of its own model steps instead measures
 * reasoning latency, which is roughly an order of magnitude larger.
 */
function sumCallDurations(events, window) {
  const calls = new Map()
  for (const event of events) {
    if (event?.type !== 'tool/call') continue
    const name = event.data?.name
    const callId = event.data?.callId
    const time = event.time
    if (typeof name !== 'string' || !name.startsWith('mcp__jev__')) continue
    if (typeof callId !== 'string' || typeof time !== 'number') continue
    if (window !== undefined && (time < window.from || time > window.to)) continue
    calls.set(callId, { time })
  }
  if (calls.size === 0) return { milliseconds: 0, paired: 0, unpaired: 0 }

  let total = 0
  let paired = 0
  let unpaired = 0
  const settled = new Set()
  for (const event of events) {
    if (event?.type !== 'tool/result') continue
    const callId = event.data?.toolCallId ?? event.data?.message?.toolCallId
    if (typeof callId !== 'string' || !calls.has(callId) || settled.has(callId)) continue
    const time = event.time
    const call = calls.get(callId)
    if (typeof time !== 'number' || time < call.time) continue
    settled.add(callId)
    total += time - call.time
    paired += 1
  }
  for (const callId of calls.keys()) if (!settled.has(callId)) unpaired += 1
  return { milliseconds: total, paired, unpaired }
}

async function latencyCommand(observationId) {
  if (disabled()) return { disabled: true, measured: false }
  if (!/^[a-f0-9-]{8,64}$/u.test(observationId ?? '')) throw new Error('invalid observation id')

  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const sessionId = process.env.DSH_SESSION_ID || ''
  const located = findSessionLog({ dshHome, sessionId })
  if (located.file === undefined) {
    return { disabled: false, measured: false, observationId, reason: located.reason ?? SESSION_LOG_REASONS.FILE_MISSING }
  }
  const decoded = readSessionLogFile(located.file)
  if (!decoded.ok) {
    return { disabled: false, measured: false, observationId, reason: decoded.reason }
  }
  const events = parseSessionEvents(decoded.text)

  let outcome
  await withLock(async ({ recordsFile }) => {
    const records = await readRecords(recordsFile)
    const target = [...records].reverse().find(record => record.observationId === observationId)
    if (!target) {
      outcome = { disabled: false, measured: false, observationId, reason: 'record-not-found' }
      return
    }
    const window = target.observedWindow
    const measured = sumCallDurations(events, window)
    if (measured.paired === 0) {
      target.metrics.latency = normalizeLatency({ availability: 'unavailable', reason: 'no-matching-calls' })
      await atomicWrite(recordsFile, encodeRecords(trimRecords(records, limits())))
      outcome = { disabled: false, measured: false, observationId, reason: 'no-matching-calls' }
      return
    }
    target.metrics.latency = normalizeLatency({ availability: 'measured', milliseconds: measured.milliseconds })
    await atomicWrite(recordsFile, encodeRecords(trimRecords(records, limits())))
    outcome = {
      disabled: false,
      measured: true,
      observationId,
      milliseconds: target.metrics.latency.milliseconds,
      calls: measured.paired,
      unpaired: measured.unpaired,
    }
  })
  return outcome
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
    provenance: {},
    labelled: 0,
  }
  for (const record of records) {
    increment(summary.statuses, enumValue(record.recommendation?.status, STATUSES, 'needs-review'))
    increment(summary.recommendations, enumValue(record.recommendation?.workflow, ACTUAL_ROUTES))
    increment(summary.actualRoutes, enumValue(record.actualRoute, ACTUAL_ROUTES))
    increment(summary.overrideSources, enumValue(record.overrideSource, OVERRIDE_SOURCES))
    increment(summary.errors, enumValue(record.errorCategory, ERROR_CATEGORIES, 'unknown'))
    increment(summary.provenance, enumValue(record.sampleProvenance, SAMPLE_PROVENANCE))
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
// Anvil high-risk misses stay cost 10. The accepted table's route-specific
// standard->direct (6) and spec-superflow->direct (5) rows override its general
// formal->direct fallback so every pre-registered row remains reachable.
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
  if (actual === 'standard-openspec' && recommended === 'direct') return 6
  if (actual === 'spec-superflow' && recommended === 'direct') return 5
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

function gate(status, actual, required) {
  return { status, actual, required }
}

function thresholdGate(actual, required, predicate) {
  if (actual === null || actual === undefined) return gate('unavailable', actual ?? null, required)
  return gate(predicate(actual, required) ? 'pass' : 'fail', actual, required)
}

// Ongoing health warnings replace the former admission gates. They fire on real
// measurements only and never block advisory, which is already approved.
function healthWarnings({
  realVibeRecords,
  mismatchRate,
  providerFailureRate,
  latencyP50,
  latencyP95,
  truncatedLatencyCount,
}) {
  const warnings = []
  if (realVibeRecords === 0) warnings.push({
    code: 'insufficient-real-vibe-samples',
    metric: 'sampleProvenance',
    actual: 0,
    required: 'any-real-vibe-record',
  })
  if (mismatchRate !== null && mismatchRate > HEALTH_THRESHOLDS.mismatchRate) warnings.push({
    code: 'mismatch-rate-above-threshold', metric: 'mismatchRate', actual: mismatchRate, required: HEALTH_THRESHOLDS.mismatchRate,
  })
  if (providerFailureRate !== null && providerFailureRate > HEALTH_THRESHOLDS.providerFailureRate) warnings.push({
    code: 'provider-failure-rate-above-threshold', metric: 'providerFailureRate', actual: providerFailureRate, required: HEALTH_THRESHOLDS.providerFailureRate,
  })
  if (latencyP50 === null || latencyP95 === null) warnings.push({
    code: 'latency-coverage-unavailable', metric: 'latencyMs', actual: null, required: { p50: HEALTH_THRESHOLDS.p50LatencyMs, p95: HEALTH_THRESHOLDS.p95LatencyMs },
  })
  if (latencyP50 !== null && latencyP50 > HEALTH_THRESHOLDS.p50LatencyMs) warnings.push({
    code: 'p50-latency-above-threshold', metric: 'p50LatencyMs', actual: latencyP50, required: HEALTH_THRESHOLDS.p50LatencyMs,
  })
  if (latencyP95 !== null && latencyP95 > HEALTH_THRESHOLDS.p95LatencyMs) warnings.push({
    code: 'p95-latency-above-threshold', metric: 'p95LatencyMs', actual: latencyP95, required: HEALTH_THRESHOLDS.p95LatencyMs,
  })
  if (truncatedLatencyCount > 0) warnings.push({
    code: 'latency-samples-truncated', metric: 'latencyMs', actual: truncatedLatencyCount, required: 0,
  })
  return warnings
}

async function reportCommand() {
  const records = await readRecords(paths().recordsFile)
  const overall = newAggregate()
  const realVibe = newAggregate()
  const confusionMatrix = emptyConfusionMatrix()
  const workingDays = new Set()
  const versions = {
    schemaVersion: {},
    routerVersion: {},
    candidateCatalogVersion: {},
  }
  const eligibleCandidateSets = {}
  const provenance = Object.fromEntries(SAMPLE_PROVENANCE.map(value => [value, 0]))
  const routeLabels = Object.fromEntries(ROUTES.map(route => [route, 0]))
  const usageTotals = { input: 0, output: 0, total: 0 }
  const latencies = []
  const realVibeRecords = []

  for (const record of records) {
    addToAggregate(overall, record)
    if (record.sampleProvenance === 'real-vibe') {
      addToAggregate(realVibe, record)
      workingDays.add(record.recordedAt.slice(0, 10))
    }
    increment(versions.schemaVersion, String(record.schemaVersion))
    increment(versions.routerVersion, String(record.routerVersion))
    increment(versions.candidateCatalogVersion, String(record.candidateCatalogVersion))
    increment(eligibleCandidateSets, candidateSetKey(record))
    increment(provenance, record.sampleProvenance)
    if (record.sampleProvenance === 'real-vibe') realVibeRecords.push(record)
    if (
      record.sampleProvenance === 'real-vibe'
      && record.metrics.latency.availability === 'measured'
    ) latencies.push(record.metrics.latency.milliseconds)
    for (const key of Object.keys(usageTotals)) usageTotals[key] += record.metrics.usage[key]

    if (record.sampleProvenance === 'real-vibe' && record.actualRoute !== 'unknown') {
      routeLabels[record.actualRoute] += 1
      if (isAutoCandidate(record)) {
        confusionMatrix[record.actualRoute][record.recommendation.workflow] += 1
      }
    }
  }

  // Mismatch rate: among real-vibe records whose actual route is known and whose
  // recommendation was actionable, how often did the advice differ from what was
  // actually done. This is the honest successor to the old weighted-cost gate.
  let mismatchComparable = 0
  let mismatchCount = 0
  let truncatedLatencyCount = 0
  for (const record of realVibeRecords) {
    if (record.actualRoute === 'unknown') continue
    if (!isAutoCandidate(record)) continue
    mismatchComparable += 1
    if (record.recommendation.workflow !== record.actualRoute) mismatchCount += 1
  }
  for (const record of realVibeRecords) {
    if (record.metrics.latency.truncated === true) truncatedLatencyCount += 1
  }

  const highCostCategories = labelledHighCostCategories(realVibeRecords)
  const weightedPerLabelled = realVibe.labelled === 0 ? null : realVibe.weightedCost / realVibe.labelled
  const needsReviewRate = realVibeRecords.length === 0 ? null : realVibe.needsReview / realVibeRecords.length
  const providerFailureRate = realVibeRecords.length === 0 ? null : realVibe.providerFailures / realVibeRecords.length
  const mismatchRate = mismatchComparable === 0 ? null : mismatchCount / mismatchComparable
  const latencyP50 = nearestRank(latencies, 0.5)
  const latencyP95 = nearestRank(latencies, 0.95)
  const warnings = healthWarnings({
    realVibeRecords: realVibeRecords.length,
    mismatchRate,
    providerFailureRate,
    latencyP50,
    latencyP95,
    truncatedLatencyCount,
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
      realVibe: {
        total: realVibe.total,
        labelled: realVibe.labelled,
        unknownLabels: realVibe.unknownLabels,
      },
      provenance,
      distinctWorkingDays: workingDays.size,
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
        'standard-openspec-to-direct-6',
        'spec-superflow-to-direct-5',
        'formal-to-direct-fallback-10',
        'direct-to-formal-2',
        'other-formal-mismatch-3',
      ],
      weightedTotal: realVibe.weightedCost,
      weightedPerLabelled,
      highCostMisses: realVibe.highCostMisses,
      needsReviewCost: 0,
    },
    quality: {
      needsReviewRate,
      providerFailureRate,
      providerFailures: realVibe.providerFailures,
      mismatchRate,
      mismatchCount,
      mismatchComparable,
      latencyMs: {
        // Event-timestamp timing: each Jev tool call's tool/call -> tool/result
        // gap from the session log, summed over the sequence.
        method: 'session-event-timestamps-nearest-rank',
        measuredCount: latencies.length,
        unavailableCount: realVibeRecords.length - latencies.length,
        p50: latencyP50,
        p95: latencyP95,
      },
      usage: {
        totals: usageTotals,
        means: meanUsage,
      },
      estimatedExternalCost: null,
      estimatedExternalCostReason: 'pricing-model-unavailable',
    },
    breakdowns: {
      provenance: groupedAggregates(records, record => record.sampleProvenance, SAMPLE_PROVENANCE),
      intentCategory: groupedAggregates(realVibeRecords, record => record.features.intent, INTENTS),
      actualRoute: groupedAggregates(realVibeRecords, record => record.actualRoute, ACTUAL_ROUTES),
      routerVersion: groupedAggregates(realVibeRecords, record => record.routerVersion),
      candidateSet: groupedAggregates(realVibeRecords, candidateSetKey),
      jevProvider: groupedAggregates(realVibeRecords, record => record.jevProvider, JEV_PROVIDERS),
      // Failed calls often cannot be attributed; the unknown group keeps them visible.
      jevProviderScope: 'attributed-records-only',
    },
    health: {
      // Ongoing observation of an approved advisory router. There is deliberately
      // no admission gate here: anything beyond giving advice needs a separate
      // approved change, and sample-count gates could never be reached because
      // this router is the only source of its own samples.
      thresholds: HEALTH_THRESHOLDS,
      warnings,
      latencyTruncatedSamples: truncatedLatencyCount,
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
  return 'usage: recorder.mjs record | label OBSERVATION_ID ACTUAL_ROUTE SOURCE | latency OBSERVATION_ID | summary | report | clear'
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
    case 'latency':
      if (args.length !== 1) throw new Error(usage())
      result = await latencyCommand(...args)
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
