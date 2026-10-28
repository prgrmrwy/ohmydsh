import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateFixture, type FixtureManifest } from './fixtures.js'
import { selftestManifest } from './selftest-manifest.js'
import { freezeInput, readFrozenInput } from './freeze.js'

export interface ModelRoute { provider: string; model: string; effort?: string }
export interface RoundItem { id: string; question: string; kind: 'Know' | 'Act'; writebackApplicable: boolean; condition: 'mem' | 'nomem'; prompt: string; followUp?: string; requiredFacts: string[]; judgements: string[] }
export interface FixedRound { id: string; version: string; tested: ModelRoute; judge: ModelRoute; items: RoundItem[]; maxJudgeCalls: number }

function fixedItems(files: ReadonlyMap<string, Buffer>): RoundItem[] {
  const questions = JSON.parse(files.get('questions.json')!.toString()) as { id: string; kind: 'Know' | 'Act'; conditions: ('mem' | 'nomem')[]; prompt: string; followUp?: string; requiredFacts: string[]; judgements: string[] }[]
  return questions.flatMap(question => question.conditions.map(condition => ({
    id: `${question.id}-${condition}`, question: question.id, kind: question.kind, writebackApplicable: question.id === 'writeback', condition, prompt: question.prompt,
    ...(question.followUp ? { followUp: question.followUp } : {}), requiredFacts: question.requiredFacts, judgements: question.judgements,
  })))
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new Error('Unexpected eval registration fields')
  return value as Record<string, unknown>
}
function route(value: unknown): ModelRoute {
  const parsed = object(value, ['provider', 'model', 'effort'])
  for (const key of ['provider', 'model']) if (typeof parsed[key] !== 'string' || !(parsed[key] as string).trim()) throw new Error('Invalid model route')
  if (parsed.effort !== undefined && (typeof parsed.effort !== 'string' || !parsed.effort.trim())) throw new Error('Invalid reasoning effort')
  return parsed as unknown as ModelRoute
}

export function parseFixedRegistration(request: unknown): { version: 'selftest-v1'; tested: ModelRoute; judge: ModelRoute; maxJudgeCalls: 12 } {
  const input = object(request, ['version', 'tested', 'judge', 'maxJudgeCalls'])
  if (input.version !== 'selftest-v1') throw new Error('Unsupported bundled selftest version')
  if (!Number.isSafeInteger(input.maxJudgeCalls) || (input.maxJudgeCalls as number) < 12 || (input.maxJudgeCalls as number) > 12) throw new Error('Fixed plan requires exactly twelve judgement calls')
  const tested = route(input.tested), judge = route(input.judge)
  return { version: 'selftest-v1', tested, judge, maxJudgeCalls: 12 }
}

/** Read-only preview of the verified bundled plan; writes nothing and allocates no round. */
export function fixedPlanPreview(): Pick<FixedRound, 'items'> {
  return { items: fixedItems(validateFixture(fileURLToPath(new URL('../../fixtures/eval/', import.meta.url)), selftestManifest)) }
}

export function registerFixedRound(root: string, request: unknown): FixedRound {
  const { tested, judge } = parseFixedRegistration(request)
  const files = validateFixture(fileURLToPath(new URL('../../fixtures/eval/', import.meta.url)), selftestManifest)
  const items = fixedItems(files)
  const plan: FixedRound = { id: `round-${randomUUID()}`, version: 'selftest-v1', tested, judge, items, maxJudgeCalls: 12 }
  freezeInput(join(root, plan.id), { plan, manifest: selftestManifest, resources: Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString('base64')])) })
  return plan
}

// selftest-v1 compatibility shape is independent of the currently published resource hashes.
const v1Paths = ['questions.json', 'repo/config.json', 'repo/README.md', 'library/cards/retry-limit.md', 'library/cards/lease-duration.md']
function frozenManifest(value: unknown): FixtureManifest {
  if (!Array.isArray(value) || value.length !== v1Paths.length) throw new Error('Invalid frozen manifest')
  const paths = new Set<string>()
  for (const raw of value) {
    const entry = object(raw, ['path', 'size', 'sha256'])
    if (typeof entry.path !== 'string' || !v1Paths.includes(entry.path) || paths.has(entry.path)
      || !Number.isSafeInteger(entry.size) || (entry.size as number) <= 0
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid frozen manifest entry')
    paths.add(entry.path)
  }
  return value as unknown as FixtureManifest
}
function validateV1Questions(files: ReadonlyMap<string, Buffer>): void {
  const questions: unknown = JSON.parse(files.get('questions.json')!.toString())
  if (!Array.isArray(questions) || questions.length !== 3) throw new Error('Invalid frozen selftest questions')
  for (const [index, raw] of questions.entries()) {
    const q = object(raw, ['id', 'kind', 'state', 'conditions', 'prompt', 'followUp', 'followUpKind', 'requiredFacts', 'source', 'judgements'])
    if (q.id !== ['know', 'stale', 'writeback'][index] || q.kind !== (index === 0 ? 'Know' : 'Act')
      || q.state !== (index === 0 ? 'valid' : 'stale') || q.source !== 'repo/config.json'
      || !isDeepStrictEqual(q.conditions, ['mem', 'nomem']) || !isDeepStrictEqual(q.judgements, ['facts', 'source-grounding'])
      || typeof q.prompt !== 'string' || !q.prompt.trim()
      || !Array.isArray(q.requiredFacts) || q.requiredFacts.length !== (index === 0 ? 1 : 2) || q.requiredFacts.some(fact => typeof fact !== 'string' || !fact.trim())
      || new Set(q.requiredFacts).size !== q.requiredFacts.length
      || (index === 2 ? typeof q.followUp !== 'string' || !q.followUp.trim() || q.followUpKind !== 'natural' : q.followUp !== undefined || q.followUpKind !== undefined)) throw new Error('Invalid frozen selftest question shape')
  }
}

/** Execution requires this release; report validates supported frozen inputs without consulting current fixtures. */
export function loadFixedRound(root: string, id: string, mode: 'execution' | 'report' = 'execution'): FixedRound {
  if (!/^round-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid round identity')
  const frozen = object(readFrozenInput(join(root, id)), ['plan', 'manifest', 'resources'])
  const plan = object(frozen.plan, ['id', 'version', 'tested', 'judge', 'items', 'maxJudgeCalls'])
  if (plan.id !== id || plan.version !== 'selftest-v1' || plan.maxJudgeCalls !== 12) throw new Error('Frozen round identity or budget mismatch')
  route(plan.tested); route(plan.judge)
  if (mode !== 'execution' && mode !== 'report') throw new Error('Invalid frozen round read mode')
  if (mode === 'execution' && !isDeepStrictEqual(frozen.manifest, selftestManifest)) throw new Error('Frozen manifest mismatch')
  const manifest = frozenManifest(frozen.manifest)
  const resources = object(frozen.resources, manifest.map(entry => entry.path))
  const files = new Map<string, Buffer>()
  for (const entry of manifest) {
    const encoded = resources[entry.path]
    if (typeof encoded !== 'string') throw new Error('Missing frozen resource')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.toString('base64') !== encoded || bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Frozen resource hash mismatch')
    files.set(entry.path, bytes)
  }
  validateV1Questions(files)
  const items = fixedItems(files)
  if (!isDeepStrictEqual(plan.items, items)) throw new Error('Frozen items differ from verified fixed questions')
  return plan as unknown as FixedRound
}
