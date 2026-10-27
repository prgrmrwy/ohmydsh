import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { resolveDecisionService } from './decision-service.js'
import { AUTO_EFFORTS, DEFAULT_SETTINGS, DEPRECATED_KEYS, type Settings, type SettingsIssue, type SettingsRead } from './settings-contract.js'
import { isRecord, issue } from './settings-validation.js'
export { DEFAULT_SETTINGS } from './settings-contract.js'
export type { Settings, SettingsPatch, SettingsIssue, SettingsRead, RoutingCatalog } from './settings-contract.js'

const ordinary = {
  decisionService: z.object({ provider: z.enum(['openrouter','typesafe','concentrate','custom']), model: z.string().regex(/^[A-Za-z0-9._:/~-]{1,128}$/).optional(), endpoint: z.string().max(2048).optional() }).strict().refine(value => { try { resolveDecisionService(value); return true } catch { return false } }, 'Invalid decision service'),
  decisionToast: z.boolean(), defaultMode: z.enum(['MANUAL', 'AUTO']),
  effortCap: z.enum(AUTO_EFFORTS), jevTimeoutMs: z.number().int().min(1000).max(8000),
}
const patchSchema = z.object(Object.fromEntries(Object.entries(ordinary).map(([key, schema]) => [key, schema.optional()]))).strict()
export class SettingsValidationError extends Error {
  constructor(public readonly issues: SettingsIssue[]) { super('自动模型路由设置无效'); this.name = 'SettingsValidationError' }
}
function schemaIssues(error: z.ZodError, prefix = ''): SettingsIssue[] {
  return error.issues.flatMap(entry => {
    // Unknown keys (retired mapping keys included) are reported by name.
    if (entry.code === 'unrecognized_keys') return entry.keys.map(key => issue([prefix, ...entry.path.map(String), key].filter(Boolean).join('.'), 'unknown-setting', '未知设置字段'))
    return [issue([prefix, ...entry.path.map(String)].filter(Boolean).join('.'), 'invalid-setting', '设置字段无效')]
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
export class SettingsStore {
  constructor(public readonly path: string) {}
  read(): SettingsRead {
    let raw: unknown
    try { raw = JSON.parse(readFileSync(this.path, 'utf8')) }
    catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      return { settings: { ...DEFAULT_SETTINGS }, status: missing ? 'missing' : 'invalid', deprecated: [], issues: missing ? [] : [issue('', 'invalid-file', '设置文件无法读取或解析，保存将覆盖它')] }
    }
    if (!isRecord(raw)) return { settings: { ...DEFAULT_SETTINGS }, status: 'invalid', deprecated: [], issues: [issue('', 'invalid-file', '设置文件必须是对象')] }
    const settings: Settings = { ...DEFAULT_SETTINGS }
    const issues: SettingsIssue[] = []
    for (const [key, schema] of Object.entries(ordinary)) {
      if (!Object.hasOwn(raw, key)) continue
      const parsed = schema.safeParse(raw[key])
      if (parsed.success) Object.assign(settings, { [key]: parsed.data })
      else {
        issues.push(...schemaIssues(parsed.error, key))
        // A malformed explicit transport must never fall back to OpenRouter.
        if (key === 'decisionService') Object.assign(settings, { decisionService: { provider: 'custom', endpoint: '' } })
      }
    }
    const deprecated = DEPRECATED_KEYS.filter(key => Object.hasOwn(raw, key))
    return { settings, issues, status: issues.length ? 'invalid' : 'ok', deprecated }
  }
  save(patch: unknown): SettingsRead {
    const parsed = patchSchema.safeParse(patch)
    const errors = [...credentialFields(patch), ...(!parsed.success ? schemaIssues(parsed.error) : [])]
    if (errors.length) throw new SettingsValidationError(errors)
    const submitted = patch as Record<string, unknown>
    const before = this.read()
    const persisted: Record<string, unknown> = {}
    // Only ordinary fields already in the file or submitted now are written; retired keys are dropped.
    let disk: unknown
    try { disk = JSON.parse(readFileSync(this.path, 'utf8')) } catch { disk = {} }
    for (const key of Object.keys(ordinary)) if ((isRecord(disk) && Object.hasOwn(disk, key)) || Object.hasOwn(submitted, key)) persisted[key] = submitted[key] ?? before.settings[key as keyof Settings]
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
    return this.read()
  }
}
