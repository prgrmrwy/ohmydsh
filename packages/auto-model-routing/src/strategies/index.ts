import { claude } from './claude.js'
import { codex } from './codex.js'
import type { Capability, FamilyStrategy, StartEffort } from './types.js'
export type { Capability, FamilyStrategy, StartEffort } from './types.js'

const CAPABILITIES: readonly Capability[] = ['bounded', 'analytical', 'frontier']
const START_EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh']
const bare = (model: string) => model.slice(model.lastIndexOf('/') + 1)
const overlaps = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

export interface Registry {
  readonly strategies: readonly FamilyStrategy[]
  /** Main-model support decision; undefined means AUTO does not manage this model. */
  familyOfMainModel(model: string | undefined): FamilyStrategy | undefined
  /** Family of a child model on an exact transport provider. */
  familyOfChild(provider: string, model: string): FamilyStrategy | undefined
  /** Child model id for a family on a transport: transport prefix + capability slot. */
  childModel(familyId: string, provider: string, capability: Capability): string | undefined
  effortStart(model: string): StartEffort | undefined
  hasProvider(provider: string): boolean
  get(familyId: string): FamilyStrategy | undefined
  providers(): string[]
  ids(): string[]
  labels(): string[]
}

/** Validates the whole list up front; any conflict throws and no partial registry exists. */
export function createRegistry(input: readonly FamilyStrategy[]): Registry {
  const strategies = input.map(s => structuredClone(s) as FamilyStrategy)
  const ids = new Set<string>()
  const starts = new Map<string, string>()
  const prefixes: { prefix: string; id: string }[] = []
  const childPrefixes = new Map<string, { prefix: string; id: string }[]>()
  for (const s of strategies) {
    if (!s.id) throw new Error('策略缺少 id')
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
    for (const capability of CAPABILITIES) if (typeof s.childModels?.[capability] !== 'string' || !s.childModels[capability]) throw new Error(`策略 ${s.id} 缺少能力槽：${capability}`)
    for (const [provider, prefix] of Object.entries(s.transports)) {
      const existing = childPrefixes.get(provider) ?? []
      const clash = existing.find(p => p.prefix === '' || prefix === '' ? true : overlaps(p.prefix, prefix))
      if (clash) {
        if (clash.prefix === '' || prefix === '') throw new Error(`provider ${provider} 的空前缀只能属于一个策略（${clash.id} 与 ${s.id} 冲突）`)
        throw new Error(`provider ${provider} 下子模型前缀重叠：${prefix}（${s.id}）与 ${clash.prefix}（${clash.id}）`)
      }
      childPrefixes.set(provider, [...existing, { prefix, id: s.id }])
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
    familyOfChild: (provider: string, model: string) => {
      const entries = childPrefixes.get(provider) ?? []
      const hit = entries.find(e => e.prefix !== '' && model.startsWith(e.prefix)) ?? (entries.length === 1 && entries[0]!.prefix === '' ? entries[0] : undefined)
      return hit ? byId.get(hit.id) : undefined
    },
    childModel: (familyId: string, provider: string, capability: Capability) => {
      const s = byId.get(familyId)
      const prefix = s?.transports[provider]
      return s && prefix !== undefined ? `${prefix}${s.childModels[capability]}` : undefined
    },
    effortStart: (model: string) => {
      const name = bare(model)
      for (const s of strategies) if (Object.hasOwn(s.effortStarts, name)) return s.effortStarts[name]
      return undefined
    },
    hasProvider: (provider: string) => childPrefixes.has(provider),
    get: (familyId: string) => byId.get(familyId),
    providers: () => [...childPrefixes.keys()],
    ids: () => strategies.map(s => s.id),
    labels: () => strategies.map(s => s.label),
  })
}

export const BUILTIN_STRATEGIES: readonly FamilyStrategy[] = [claude, codex]
/** The registry every module uses unless a test injects strategies through `apply(ctx, { strategies })`. */
export const registry: Registry = createRegistry(BUILTIN_STRATEGIES)
