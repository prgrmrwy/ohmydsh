import Schema from '@deepseek-ai/schemastery'
import type { Context, Fiber } from '@deepseek-ai/cordis'
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
    memory: Schema.boolean(),
  })).default([]),
  bindings: Schema.array(Schema.object({
    name: Schema.string().required(),
    read: stringList(),
    write: stringList(),
  })).default([]),
  // Declarations only close: `true` is not a value, so "open" means deleting the
  // closure rather than overriding one set elsewhere.
  workspaces: Schema.array(Schema.object({
    path: Schema.string().required(),
    primary: Schema.string(),
    memory: Schema.const(false),
    fallback: Schema.const(false),
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

  const declared = validateWorkspaceDeclarations(value, paths)

  const primaries = new Set(entries.filter(entry => entry.primary === true).map(entry => entry.name))
  for (const [kind, claims] of [['path prefix', paths], ['remote pattern', patterns]] as const) {
    for (const [key, names] of claims) {
      const unique = [...new Set(names)]
      if (unique.length < 2) continue
      // A declaration already proved to name an exact claimer settles the group.
      if (kind === 'path prefix' && declared.has(key)) continue
      const marked = unique.filter(name => primaries.has(name))
      if (marked.length !== 1) {
        const remedy = kind === 'path prefix'
          ? 'mark exactly one with primary: true, or declare its primary under workspaces'
          : 'mark exactly one with primary: true'
        throw new Error(`${kind} ${key} is claimed by ${unique.join(', ')} but has ${marked.length} primary entries; ${remedy}`)
      }
    }
  }
}

/**
 * Judge the path-keyed workspace declarations.
 *
 * Paths are normalized like path prefixes and must be unique, the switches may
 * only close, and a declared primary must claim exactly that path — a claim on
 * an ancestor is inherited routing, not membership of this group.
 * @param value - the candidate settings section.
 * @param paths - normalized path prefix → the scope names claiming it.
 * @returns the normalized paths whose declaration names a primary.
 */
function validateWorkspaceDeclarations(value: ScopeConfig, paths: ReadonlyMap<string, readonly string[]>): Set<string> {
  const scopeNames = new Set(['personal', ...value.scopes.map(entry => entry.name)])
  const seen = new Map<string, number>()
  const declared = new Set<string>()
  for (const [index, declaration] of (value.workspaces ?? []).entries()) {
    const raw = typeof declaration.path === 'string' ? declaration.path : ''
    if (raw.trim() === '') throw new Error(`workspaces[${index}] has no path`)
    const label = `workspaces[${index}] (${raw})`
    for (const key of ['memory', 'fallback'] as const) {
      if (declaration[key] !== undefined && declaration[key] !== false) {
        throw new Error(`${label}: ${key} may only be false; open a workspace by removing the declaration`)
      }
    }
    const path = normalizePath(raw)
    const prior = seen.get(path)
    if (prior !== undefined) throw new Error(`${label} duplicates workspaces[${prior}]: both declare ${path}`)
    seen.set(path, index)
    if (declaration.primary === undefined) continue
    if (!scopeNames.has(declaration.primary)) {
      throw new Error(`${label}: primary ${declaration.primary} is not a declared scope`)
    }
    if (!(paths.get(path) ?? []).includes(declaration.primary)) {
      throw new Error(`${label}: primary ${declaration.primary} does not claim this exact path`)
    }
    declared.add(path)
  }
  return declared
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

/**
 * The live scope-table fields of the plugin Config, at fixed object paths.
 *
 * DSH 0.2.0 removed the separate settings registry (`ctx.settings.register`,
 * `settings.yaml`): configurable values belong to the plugin's own Cordis
 * Config, and fields that change without a remount are declared `.volatile()`.
 * The loader commits a validated volatile-only edit into these references and
 * emits `loader/volatile-update`; the settings form edits exactly these paths.
 */
export const MEMEX_CONFIG_PATHS = ['autoDerive', 'scopes', 'bindings', 'workspaces'] as const

/**
 * The plugin Config as a plain Schemastery schema — the loader recognises
 * volatile paths only on a Schemastery schema (`~standard.vendor`), and
 * references may not sit inside a transform, so cross-field rules are not part
 * of the schema. They run in {@link validateScopeTable}: on mount (apply) and
 * through the plugin's `internal/config` hook, which is what both the settings
 * pre-check and the loader's volatile commit call before touching references.
 */
const fields = MemexSettingsSchema.dict as Record<(typeof MEMEX_CONFIG_PATHS)[number], Schema>
export const Config = Schema.object({
  // Organization keys: deployment facts from the (private) row config. Ordinary,
  // not volatile — changing them remounts the plugin, and the form never shows them.
  internalHosts: Schema.array(Schema.string()),
  internalDomains: Schema.array(Schema.string()),
  autoDerive: fields.autoDerive.volatile(),
  scopes: fields.scopes.volatile(),
  bindings: fields.bindings.volatile(),
  workspaces: fields.workspaces.volatile(),
})

interface Ref<T> { get(): T }
export interface Config {
  readonly internalHosts?: readonly string[]
  readonly internalDomains?: readonly string[]
  readonly autoDerive: Ref<boolean>
  readonly scopes: Ref<ScopeConfig['scopes']>
  readonly bindings: Ref<ScopeConfig['bindings']>
  readonly workspaces: Ref<NonNullable<ScopeConfig['workspaces']>>
}

/** Parse and fully validate a raw row config; throws on shape or cross-field violations. */
export function parseConfig(raw: unknown): Config {
  const value = Config((raw ?? {}) as never) as unknown as Config
  validateMemexSettings(readScopeConfig(value))
  return value
}

/**
 * Validate every config candidate of this plugin instance before it is used:
 * the loader parses a volatile-only edit through `internal/config` and keeps the
 * running references (last-good) when this throws.
 */
export function guardConfigCandidates(ctx: Context): void {
  ctx.on('internal/config', function (this: Fiber, _raw: unknown, next: () => unknown) {
    const raw = next()
    if (this === ctx.fiber) parseConfig(raw)
    return raw
  })
}

/** Read the current scope table out of the Config's volatile references. */
export function readScopeConfig(config: Config): ScopeConfig {
  return {
    autoDerive: config.autoDerive.get(),
    scopes: config.scopes.get(),
    bindings: config.bindings.get(),
    workspaces: config.workspaces.get(),
  }
}
