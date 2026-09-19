import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { ScopeConfig } from './types.js'

const scopeName = Schema.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required()
const optionalString = Schema.string()
const stringList = () => Schema.array(Schema.string()).default([])

export const MemexSettingsSchema = Schema.object({
  autoDerive: Schema.boolean().default(true),
  scopes: Schema.array(Schema.object({
    name: scopeName,
    home: optionalString,
    pathPrefixes: stringList(),
    remotePatterns: stringList(),
    publish: Schema.union(['internal', 'external'] as const).default('external'),
  })).default([]),
  bindings: Schema.array(Schema.object({
    name: Schema.string().required(),
    read: stringList(),
    write: stringList(),
  })).default([]),
})

export type MemexSettings = ScopeConfig

export function validateMemexSettings(value: ScopeConfig): void {
  const declaredNames = new Set<string>()
  for (const entry of value.scopes) {
    if (declaredNames.has(entry.name)) throw new Error(`duplicate scope name: ${entry.name}`)
    declaredNames.add(entry.name)
    for (const pattern of entry.remotePatterns ?? []) {
      try { new RegExp(pattern) } catch (error) {
        throw new Error(`invalid remote pattern for scope ${entry.name}: ${pattern}`, { cause: error })
      }
    }
  }

  const scopeNames = new Set<string>(['personal', ...declaredNames])
  const bindingNames = new Set<string>()
  const boundScopes = new Map<string, string>()
  for (const binding of value.bindings) {
    if (bindingNames.has(binding.name)) throw new Error(`duplicate binding name: ${binding.name}`)
    bindingNames.add(binding.name)
    for (const scope of new Set([...binding.read, ...binding.write])) {
      if (!scopeNames.has(scope)) throw new Error(`binding ${binding.name} references unknown scope: ${scope}`)
      const prior = boundScopes.get(scope)
      if (prior && prior !== binding.name) throw new Error(`scope ${scope} belongs to multiple bindings: ${prior}, ${binding.name}`)
      boundScopes.set(scope, binding.name)
    }
  }
}

export function registerMemexSettings(ctx: Context): SettingsScope<ScopeConfig> {
  return ctx.settings.register('dsh-memex', MemexSettingsSchema, {
    applies: 'live',
    validate: validateMemexSettings,
  }) as SettingsScope<ScopeConfig>
}
