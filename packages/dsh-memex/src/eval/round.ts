import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateFixture } from './fixtures.js'
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

export function loadFixedRound(root: string, id: string): FixedRound {
  if (!/^round-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid round identity')
  const frozen = object(readFrozenInput(join(root, id)), ['plan', 'manifest', 'resources'])
  const plan = object(frozen.plan, ['id', 'version', 'tested', 'judge', 'items', 'maxJudgeCalls'])
  if (plan.id !== id || plan.version !== 'selftest-v1' || plan.maxJudgeCalls !== 12) throw new Error('Frozen round identity or budget mismatch')
  route(plan.tested); route(plan.judge)
  if (!isDeepStrictEqual(frozen.manifest, selftestManifest)) throw new Error('Frozen manifest mismatch')
  const resources = object(frozen.resources, selftestManifest.map(entry => entry.path))
  const files = new Map<string, Buffer>()
  for (const entry of selftestManifest) {
    const encoded = resources[entry.path]
    if (typeof encoded !== 'string') throw new Error('Missing frozen resource')
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.toString('base64') !== encoded || bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('Frozen resource hash mismatch')
    files.set(entry.path, bytes)
  }
  const items = fixedItems(files)
  if (!isDeepStrictEqual(plan.items, items)) throw new Error('Frozen items differ from verified fixed questions')
  return plan as unknown as FixedRound
}
