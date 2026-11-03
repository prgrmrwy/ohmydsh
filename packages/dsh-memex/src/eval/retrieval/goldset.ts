/*
 * Retrieval runner API: loadGoldset({path, content, set, snapshotSlugs}) performs
 * complete bounded UTF-8 JSON/schema/topic validation, explicit set selection,
 * and selected-target existence checks before any output or search. It returns
 * selected questions and a holdout-only filename suffix when appropriate.
 */
import { isSafeKernelSlug } from './snapshot.js'

export interface GoldQuestion {
  id: string
  query: string
  targets: string[]
  type: 'single-hop' | 'multi-hop'
  topic: string
  origin: string
  set: 'dev' | 'holdout'
}
export interface GoldsetResult { questions: GoldQuestion[]; allTargetSlugs: string[]; reportSuffix: string }
export interface LoadGoldsetOptions { path: string; content: string | Buffer; set?: 'dev' | 'holdout'; snapshotSlugs: readonly string[] }
const MAX_BYTES = 1024 * 1024
const MAX_QUESTIONS = 500
const FIELDS = ['id', 'query', 'targets', 'type', 'topic', 'origin', 'set'] as const
function issue(path: string, location: string, message: string): never { throw new Error(`${path} ${location}: ${message}`) }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 }

export function loadGoldset(options: LoadGoldsetOptions): GoldsetResult {
  const bytes = Buffer.isBuffer(options.content) ? options.content : Buffer.from(options.content, 'utf8')
  const rootError = (message: string): never => issue(options.path, '$', message)
  if (bytes.length > MAX_BYTES) rootError(`file exceeds ${MAX_BYTES} bytes`)
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { rootError('invalid UTF-8 JSON') }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_QUESTIONS) rootError(`expected an array with 1..${MAX_QUESTIONS} questions`)
  const rows = parsed as unknown[]
  const ids = new Set<string>()
  const topics = new Map<string, string>()
  const questions: GoldQuestion[] = []
  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index]
    const id = raw && typeof raw === 'object' && nonempty((raw as Record<string, unknown>).id) ? (raw as Record<string, unknown>).id as string : `#${index}`
    const where = `${id}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) issue(options.path, `${where} $`, 'question must be an object')
    const value = raw as Record<string, unknown>
    for (const key of Object.keys(value)) if (!(FIELDS as readonly string[]).includes(key)) issue(options.path, `${where} ${key}`, 'unknown field')
    for (const key of FIELDS) if (!(key in value)) issue(options.path, `${where} ${key}`, 'required field missing')
    if (!nonempty(value.id)) issue(options.path, `${where} id`, 'must be a non-empty string')
    if (ids.has(value.id)) issue(options.path, `${where} id`, 'must be unique')
    ids.add(value.id)
    if (!nonempty(value.query) || [...value.query].length > 500) issue(options.path, `${where} query`, 'must be non-empty and at most 500 characters')
    if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > 10) issue(options.path, `${where} targets`, 'must contain 1..10 slugs')
    const targetSet = new Set<string>()
    for (const slug of value.targets) {
      if (typeof slug !== 'string' || !isSafeKernelSlug(slug)) issue(options.path, `${where} targets`, `invalid slug ${String(slug)}`)
      if (targetSet.has(slug)) issue(options.path, `${where} targets`, `duplicate slug ${slug}`)
      targetSet.add(slug)
    }
    if (value.type !== 'single-hop' && value.type !== 'multi-hop') issue(options.path, `${where} type`, 'must be single-hop or multi-hop')
    if (!nonempty(value.topic)) issue(options.path, `${where} topic`, 'must be non-empty')
    if (!nonempty(value.origin)) issue(options.path, `${where} origin`, 'must be non-empty')
    if (value.set !== 'dev' && value.set !== 'holdout') issue(options.path, `${where} set`, 'must be dev or holdout')
    const priorSet = topics.get(value.topic)
    if (priorSet && priorSet !== value.set) issue(options.path, `${where} topic`, `topic ${value.topic} spans sets ${priorSet} and ${value.set}`)
    topics.set(value.topic, value.set)
    questions.push(value as unknown as GoldQuestion)
  }
  if (options.set !== 'dev' && options.set !== 'holdout') throw new Error(`${options.path} $: --set is required (dev or holdout)`)
  const selected = questions.filter(question => question.set === options.set)
  if (selected.length === 0) throw new Error(`${options.path} $: selected set ${options.set} is empty`)
  const available = new Set(options.snapshotSlugs)
  for (const question of selected) for (const slug of question.targets) if (!available.has(slug)) issue(options.path, `${question.id} targets`, `target slug missing from snapshot: ${slug}`)
  return { questions: selected, allTargetSlugs: [...new Set(questions.flatMap(question => question.targets))], reportSuffix: options.set === 'holdout' ? '-holdout' : '' }
}
