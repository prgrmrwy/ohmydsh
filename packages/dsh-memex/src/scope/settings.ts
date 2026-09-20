import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizePath } from './resolver.js'
import type { ScopeConfig } from './types.js'

const scopeName = Schema.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required()
const optionalString = Schema.string()
const stringList = () => Schema.array(Schema.string()).default([])

export const MemexSettingsSchema = Schema.object({
  autoDerive: Schema.boolean().default(true),
  scopes: Schema.array(Schema.object({
    name: scopeName,
    primary: Schema.boolean(),
    home: optionalString,
    pathPrefixes: stringList(),
    remotePatterns: stringList(),
    publish: Schema.union(['internal', 'external'] as const).default('external'),
    fallback: Schema.boolean(),
  })).default([]),
  bindings: Schema.array(Schema.object({
    name: Schema.string().required(),
    read: stringList(),
    write: stringList(),
  })).default([]),
})

export type MemexSettings = ScopeConfig

/**
 * Judge every claim the configuration makes about a workspace.
 *
 * Two scopes may share a workspace — one library per publication direction — but
 * then exactly one of them must be marked primary; leaving it to declaration
 * order is what silently routes a knowledge domain's memory into another
 * library. The same rule covers a remote pattern written verbatim twice.
 *
 * Remote patterns that merely *overlap* cannot be compared as text, so that case
 * is judged at resolution time instead (see the scope resolver).
 *
 * One library directory, by contrast, may never be shared: two scope names over
 * one store have one sync target and no way to tell them apart.
 * @param value - the candidate settings section.
 */
function validateExclusiveClaims(value: ScopeConfig): void {
  const namespaceDir = join(homedir(), '.dsh-memex')
  // The implicit `personal` scope owns its default library even when undeclared,
  // because write targets include it by default.
  const entries = value.scopes.some(entry => entry.name === 'personal')
    ? [...value.scopes]
    : [...value.scopes, { name: 'personal' }]

  const homes = new Map<string, string>()
  const claim = (claims: Map<string, string[]>, key: string, name: string): void => {
    claims.set(key, [...(claims.get(key) ?? []), name])
  }
  const paths = new Map<string, string[]>()
  const patterns = new Map<string, string[]>()

  for (const entry of entries) {
    const home = entry.home === undefined ? join(namespaceDir, entry.name) : normalizePath(entry.home)
    const homeOwner = homes.get(home)
    if (homeOwner !== undefined) {
      throw new Error(`scopes ${homeOwner} and ${entry.name} share the library path ${home}`)
    }
    homes.set(home, entry.name)
    for (const prefix of entry.pathPrefixes ?? []) {
      if (prefix.trim() !== '') claim(paths, normalizePath(prefix), entry.name)
    }
    for (const pattern of entry.remotePatterns ?? []) claim(patterns, pattern, entry.name)
  }

  const primaries = new Set(entries.filter(entry => entry.primary === true).map(entry => entry.name))
  for (const [kind, claims] of [['path prefix', paths], ['remote pattern', patterns]] as const) {
    for (const [key, names] of claims) {
      const unique = [...new Set(names)]
      if (unique.length < 2) continue
      const marked = unique.filter(name => primaries.has(name))
      if (marked.length !== 1) {
        throw new Error(`${kind} ${key} is claimed by ${unique.join(', ')} but has ${marked.length} primary entries; mark exactly one with primary: true`)
      }
    }
  }
}

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

  validateExclusiveClaims(value)

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
