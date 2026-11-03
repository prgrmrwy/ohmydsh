import { claude } from './claude.js'
import { codex } from './codex.js'
import type { Capability, FamilyStrategy, StartEffort } from './types.js'
export type { Capability, FamilyStrategy, StartEffort } from './types.js'

const CAPABILITIES: readonly Capability[] = ['bounded', 'analytical', 'frontier']
const START_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh']
const bare = (model: string) => model.slice(model.lastIndexOf('/') + 1)
const prefixOf = (model: string) => model.slice(0, Math.max(0, model.lastIndexOf('/')))
const KEYS = new Set(['id', 'label', 'modelPrefixes', 'effortStarts', 'childModels'])
const overlaps = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

export interface Registry {
  readonly strategies: readonly FamilyStrategy[]
  /** Main-model support decision; undefined means AUTO does not manage this model. */
  familyOfMainModel(model: string | undefined): FamilyStrategy | undefined
  /** Catalog entry for a capability slot: same bare name (case-insensitive) and the parent's exact prefix, unique or none. */
  resolveSlot(familyId: string, capability: Capability, parentModel: string, models: readonly string[]): string | undefined
  effortStart(model: string): StartEffort | undefined
  get(familyId: string): FamilyStrategy | undefined
  ids(): string[]
  labels(): string[]
}

/** Validates the whole list up front; any conflict throws and no partial registry exists. */
export function createRegistry(input: readonly FamilyStrategy[]): Registry {
  const strategies = input.map(s => structuredClone(s) as FamilyStrategy)
  const ids = new Set<string>()
  const starts = new Map<string, string>()
  const prefixes: { prefix: string; id: string }[] = []
  for (const s of strategies) {
    if (!s.id) throw new Error('策略缺少 id')
    for (const key of Object.keys(s)) if (!KEYS.has(key)) throw new Error(`策略 ${s.id} 含未知键：${key}`)
    if (ids.has(s.id)) throw new Error(`策略 id 重复：${s.id}`)
    ids.add(s.id)
    for (const prefix of s.modelPrefixes) {
      const lower = prefix.toLowerCase()
      if (!lower) throw new Error(`策略 ${s.id} 的模型前缀为空`)
      const clash = prefixes.find(p => overlaps(p.prefix.toLowerCase(), lower))
      if (clash) throw new Error(`模型前缀重叠：${prefix}（${s.id}）与 ${clash.prefix}（${clash.id}）`)
      prefixes.push({ prefix, id: s.id })
    }
    for (const [model, effort] of Object.entries(s.effortStarts)) {
      if (!START_EFFORTS.includes(effort)) throw new Error(`策略 ${s.id} 的起点 effort 非法：${model}=${String(effort)}`)
      if (starts.has(model)) throw new Error(`起点键重复：${model}（${starts.get(model)} 与 ${s.id}）`)
      starts.set(model, s.id)
    }
    for (const capability of CAPABILITIES) {
      const slot = s.childModels?.[capability]
      if (typeof slot !== 'string' || !slot) throw new Error(`策略 ${s.id} 缺少能力槽：${capability}`)
      if (slot.includes('/')) throw new Error(`策略 ${s.id} 的能力槽不能含 /：${slot}`)
    }
  }
  const byId = new Map(strategies.map(s => [s.id, s]))
  return Object.freeze({
    strategies,
    familyOfMainModel: (model: string | undefined) => {
      if (typeof model !== 'string' || !model) return undefined
      const name = bare(model).toLowerCase()
      return strategies.find(s => s.modelPrefixes.some(p => name.startsWith(p.toLowerCase())))
    },
    resolveSlot: (familyId: string, capability: Capability, parentModel: string, models: readonly string[]) => {
      const slot = byId.get(familyId)?.childModels[capability]?.toLowerCase()
      if (!slot) return undefined
      const hits = models.filter(m => bare(m).toLowerCase() === slot && prefixOf(m) === prefixOf(parentModel))
      return hits.length === 1 ? hits[0] : undefined
    },
    effortStart: (model: string) => {
      const name = bare(model)
      for (const s of strategies) if (Object.hasOwn(s.effortStarts, name)) return s.effortStarts[name]
      return undefined
    },
    get: (familyId: string) => byId.get(familyId),
    ids: () => strategies.map(s => s.id),
    labels: () => strategies.map(s => s.label),
  })
}

export const BUILTIN_STRATEGIES: readonly FamilyStrategy[] = [claude, codex]
/** The registry every module uses unless a test injects strategies through `apply(ctx, { strategies })`. */
export const registry: Registry = createRegistry(BUILTIN_STRATEGIES)
