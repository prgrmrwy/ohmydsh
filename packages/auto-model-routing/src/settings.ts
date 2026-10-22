import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { tiers, type Tier } from './effort.js'
import { AUTO_EFFORTS, DEFAULT_SETTINGS, type AutomaticEffort, type RoutingCatalog, type Settings, type SettingsIssue, type SettingsRead } from './settings-contract.js'
import { isRecord, issue, MODEL_ID_PATTERN, validateChildRoute, validateFamilyMainEffort, validateMainRoute } from './settings-validation.js'
export { DEFAULT_SETTINGS } from './settings-contract.js'
export type { Settings, SettingsPatch, SettingsIssue, SettingsRead, RoutingCatalog } from './settings-contract.js'

const ordinary = {
  decisionToast: z.boolean(), defaultMode: z.enum(['MANUAL', 'AUTO']),
  effortCap: z.enum(AUTO_EFFORTS), jevTimeoutMs: z.number().int().min(1000).max(4500),
}
const provider = z.enum(['claude', 'codex'])
const tier = z.enum(['simple', 'standard', 'complex', 'escalated'])
const model = z.string().regex(MODEL_ID_PATTERN)
const effort = z.enum(AUTO_EFFORTS)
const child = z.object({ model, reasoningEffort: effort }).strict()
const patchSchema = z.object({
  ...Object.fromEntries(Object.entries(ordinary).map(([key, schema]) => [key, schema.optional()])),
  mainEfforts: z.partialRecord(provider, z.partialRecord(tier, effort.nullable()).nullable()).optional(),
  childRoutes: z.partialRecord(provider, z.partialRecord(tier, child.nullable())).optional(),
}).strict()
const routeSchemas = {
  mainEfforts: z.partialRecord(provider, z.partialRecord(tier, effort)),
  childRoutes: z.partialRecord(provider, z.partialRecord(tier, child)),
}
export class SettingsValidationError extends Error {
  constructor(public readonly issues: SettingsIssue[]) { super('自动模型路由设置无效'); this.name = 'SettingsValidationError' }
}
function schemaIssues(error: z.ZodError, prefix = ''): SettingsIssue[] {
  return error.issues.map(entry => issue([prefix, ...entry.path.map(String)].filter(Boolean).join('.'), 'invalid-setting', '设置字段无效'))
}
function mainKeyIssues(value: unknown): SettingsIssue[] {
  if (!isRecord(value) || !isRecord(value.mainEfforts)) return []
  return Object.entries(value.mainEfforts).flatMap(([provider, family]) => {
    if (!['claude', 'codex'].includes(provider)) return [issue(`mainEfforts.${provider}`, 'invalid-setting', 'Invalid provider')]
    return isRecord(family) ? Object.keys(family).filter(key => !tiers.includes(key as Tier)).map(key => issue(`mainEfforts.${provider}.${key}`, 'invalid-setting', 'Invalid tier')) : []
  })
}
function credentialFields(value: unknown, path = ''): SettingsIssue[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, entry]) => {
    const next = path ? `${path}.${key}` : key
    if (/(password|secret|token|credential|private.?key|api.?key)/i.test(key)) return [issue(next, 'credential-field', '凭据不能保存在设置文件中')]
    return credentialFields(entry, next)
  })
}
/** Visit identifiable cells, never filtering malformed containers into an empty/default map. */
function cells(settings: Settings, visit: (kind: 'mainEfforts' | 'childRoutes', provider: string, tier: string, value: unknown, path: string) => void): void {
  for (const kind of ['mainEfforts', 'childRoutes'] as const) {
    const map: unknown = settings[kind]
    if (!isRecord(map)) continue
    for (const [provider, values] of Object.entries(map)) {
      if (!isRecord(values)) continue
      for (const [tier, value] of Object.entries(values)) visit(kind, provider, tier, value, `${kind}.${provider}.${tier}`)
    }
  }
}
export function validateSettingsRoutes(settings: Settings, catalog: RoutingCatalog): SettingsIssue[] {
  const issues: SettingsIssue[] = []
  cells(settings, (kind, provider, tier, value, path) => {
    if (!tiers.includes(tier as Tier)) return
    const explicitEffort = kind === 'mainEfforts' ? value : isRecord(value) ? value.reasoningEffort : undefined
    if (AUTO_EFFORTS.includes(explicitEffort as AutomaticEffort) && AUTO_EFFORTS.indexOf(explicitEffort as AutomaticEffort) > AUTO_EFFORTS.indexOf(settings.effortCap)) {
      issues.push(issue(path, 'effort-cap', '超过推理强度上限'))
    } else issues.push(...(kind === 'mainEfforts' ? validateFamilyMainEffort(catalog, provider, value, settings.effortCap, path) : validateChildRoute(catalog, provider, value, settings.effortCap, path)))
  })
  const main: unknown = settings.mainEfforts
  if (isRecord(main)) for (const [provider, family] of Object.entries(main)) {
    if (!isRecord(family)) continue
    for (const [model, legacy] of Object.entries(family)) {
      if (!isRecord(legacy)) continue
      for (const [tier, effort] of Object.entries(legacy)) if (tiers.includes(tier as Tier) && AUTO_EFFORTS.includes(effort as AutomaticEffort) && AUTO_EFFORTS.indexOf(effort as AutomaticEffort) > AUTO_EFFORTS.indexOf(settings.effortCap)) issues.push(issue(`mainEfforts.${provider}.${model}.${tier}`, 'effort-cap', '超过推理强度上限'))
    }
  }
  return issues
}
/** Returns undefined only for a genuinely absent cell; malformed containers/cells throw. */
export function explicitMainEffort(settings: Settings, provider: string, model: string, tier: Tier, catalog: RoutingCatalog): AutomaticEffort | undefined {
  const family = explicitCell(settings.mainEfforts, [provider], 'mainEfforts')
  if (family.present && (!isRecord(family.value) || Object.entries(family.value).some(([key, value]) => !tiers.includes(key as Tier) || isRecord(value)))) {
    throw new SettingsValidationError([issue(`mainEfforts.${provider}`, 'invalid-route', '主会话映射必须按体系和档位配置，请替换旧模型映射或恢复默认')])
  }
  const value = explicitCell(settings.mainEfforts, [provider, tier], 'mainEfforts')
  if (!value.present) return undefined
  const errors = validateMainRoute(catalog, provider, model, value.value, settings.effortCap, `mainEfforts.${provider}.${tier}`)
  if (errors.length) throw new SettingsValidationError(errors)
  return value.value as AutomaticEffort
}
export function explicitChildRoute(settings: Settings, provider: string, tier: Tier, catalog: RoutingCatalog): import('./settings-contract.js').ChildRoute | undefined {
  const value = explicitCell(settings.childRoutes, [provider, tier], 'childRoutes')
  if (!value.present) return undefined
  const errors = validateChildRoute(catalog, provider, value.value, settings.effortCap, `childRoutes.${provider}.${tier}`)
  if (errors.length) throw new SettingsValidationError(errors)
  return value.value as import('./settings-contract.js').ChildRoute
}
function explicitCell(root: unknown, keys: string[], path: string): { present: boolean; value?: unknown } {
  let value = root
  if (value === undefined) return { present: false }
  for (const key of keys) {
    if (!isRecord(value)) throw new SettingsValidationError([issue(path, 'invalid-route', '显式路由配置格式无效')])
    if (!Object.hasOwn(value, key)) return { present: false }
    value = value[key]; path += `.${key}`
  }
  return { present: true, value }
}
function hasCellChanges(patch: Record<string, unknown>, depth: number): boolean {
  return Object.values(patch).some(value => depth === 1 || !isRecord(value) || hasCellChanges(value, depth - 1))
}
function mergeCells(current: unknown, patch: Record<string, unknown>, depth: number, path: string): unknown {
  if (!hasCellChanges(patch, depth)) return structuredClone(current)
  if (current !== undefined && !isRecord(current)) throw new SettingsValidationError([issue(path, 'invalid-route', '显式路由容器格式无效，请先修复设置文件')])
  const merged = isRecord(current) ? structuredClone(current) : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key]
    else if (depth > 1 && isRecord(value)) {
      const previous = Object.hasOwn(merged, key) ? merged[key] : undefined
      // A nonempty canonical family submission explicitly replaces a legacy/malformed family.
      const replaceFamily = path === 'mainEfforts' && Object.keys(value).length > 0 && (!isRecord(previous) || Object.entries(previous).some(([entry, value]) => !tiers.includes(entry as Tier) || isRecord(value)))
      const nested = mergeCells(replaceFamily ? undefined : previous, value, depth - 1, `${path}.${key}`)
      if (nested !== undefined && (!isRecord(nested) || Object.keys(nested).length)) Object.defineProperty(merged, key, { value: nested, enumerable: true, configurable: true, writable: true })
      else delete merged[key]
    } else Object.defineProperty(merged, key, { value: structuredClone(value), enumerable: true, configurable: true, writable: true })
  }
  return merged
}
export class SettingsStore {
  constructor(public readonly path: string) {}
  read(catalog?: RoutingCatalog): SettingsRead {
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.path, 'utf8')) }
    catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      return { settings: { ...DEFAULT_SETTINGS }, status: missing ? 'missing' : 'invalid', issues: missing ? [] : [issue('', 'invalid-file', '设置文件无法读取或解析，保存将覆盖它')] }
    }
    if (!isRecord(raw)) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid', issues: [issue('', 'invalid-file', '设置文件必须是对象')] }
    const settings: Settings = { ...DEFAULT_SETTINGS }
    const issues: SettingsIssue[] = []
    for (const [key, schema] of Object.entries(ordinary)) {
      if (!Object.hasOwn(raw, key)) continue
      const parsed = schema.safeParse(raw[key])
      if (parsed.success) Object.assign(settings, { [key]: parsed.data })
      else issues.push(...schemaIssues(parsed.error, key))
    }
    for (const kind of ['mainEfforts', 'childRoutes'] as const) {
      if (!Object.hasOwn(raw, kind)) continue
      Object.assign(settings, { [kind]: raw[kind] })
      const parsed = routeSchemas[kind].safeParse(raw[kind])
      if (!parsed.success) issues.push(...schemaIssues(parsed.error, kind))
    }
    issues.push(...mainKeyIssues(raw))
    if (catalog) issues.push(...validateSettingsRoutes(settings, catalog))
    return { settings, issues, status: issues.length ? 'invalid' : 'ok' }
  }
  save(patch: unknown, catalog: RoutingCatalog): SettingsRead {
    const parsed = patchSchema.safeParse(patch)
    const errors = [...credentialFields(patch), ...mainKeyIssues(patch), ...(!parsed.success ? schemaIssues(parsed.error) : [])]
    if (errors.length) throw new SettingsValidationError(errors)
    const submitted = patch as Record<string, unknown>
    const before = this.read()
    const persisted: Record<string, unknown> = {}
    // Only persist existing scalar fields; ordinary invalid values are normalized on an explicit save.
    let disk: unknown
    try { disk = JSON.parse(readFileSync(this.path, 'utf8')) } catch { disk = {} }
    for (const key of Object.keys(ordinary)) if ((isRecord(disk) && Object.hasOwn(disk, key)) || Object.hasOwn(submitted, key)) persisted[key] = submitted[key] ?? before.settings[key as keyof Settings]
    for (const kind of ['mainEfforts', 'childRoutes'] as const) {
      const existing: unknown = before.settings[kind]
      if (Object.hasOwn(submitted, kind)) {
        const merged = mergeCells(existing, submitted[kind] as Record<string, unknown>, 2, kind)
        if (merged !== undefined && (!isRecord(merged) || Object.keys(merged).length)) persisted[kind] = merged
      } else if (existing !== undefined) persisted[kind] = existing
    }
    const next = { ...DEFAULT_SETTINGS, ...persisted } as Settings
    const capChanged = next.effortCap !== before.settings.effortCap
    const touched = new Set<string>()
    const previous = new Map<string, unknown>()
    cells(before.settings, (_kind, _provider, _tier, value, path) => { previous.set(path, value) })
    cells(submitted as unknown as Settings, (_kind, _provider, _tier, value, path) => {
      const oldMain: unknown = before.settings.mainEfforts
      const oldFamily = isRecord(oldMain) ? oldMain[_provider] : undefined
      const replacesFamily = _kind === 'mainEfforts' && oldFamily !== undefined && (!isRecord(oldFamily) || Object.entries(oldFamily).some(([key, value]) => !tiers.includes(key as Tier) || isRecord(value)))
      if (value !== null && (replacesFamily || JSON.stringify(value) !== JSON.stringify(previous.get(path)))) touched.add(path)
    })
    const validation = validateSettingsRoutes(next, catalog).filter(entry => touched.has(entry.path) || (capChanged && entry.code === 'effort-cap'))
    if (validation.length) throw new SettingsValidationError(validation)
    const directory = dirname(this.path)
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700)
    const temporary = `${this.path}.tmp-${randomUUID()}`
    try {
      writeFileSync(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, this.path)
    } catch (error) {
      // The temporary name is created here in the fixed target directory, never from payload data.
      try { unlinkSync(temporary) } catch {}
      throw error
    }
    return this.read(catalog)
  }
}
