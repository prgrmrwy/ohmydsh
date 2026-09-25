import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

export const SPEC_SUPERFLOW_SKILLS = Object.freeze([
  'bug-investigator',
  'build-executor',
  'code-reviewer',
  'contract-builder',
  'need-explorer',
  'release-archivist',
  'spec-merger',
  'spec-writer',
  'workflow-start',
])

const RESOURCE_TYPES = new Set(['npm-workflow', 'npm-mcp-server', 'openspec-schema'])
const ID = /^[a-z0-9][a-z0-9._-]*$/
const PACKAGE_NAME = /^(?:@[^/@]+\/[^/@]+|[^/@]+)$/
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const SHA256 = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const SAFE_TARGET = /^[a-z0-9][a-z0-9._-]*$/

const COMMON_FIELDS = ['id', 'type', 'enabled']
const FIELDS = {
  'npm-workflow': [...COMMON_FIELDS, 'spec', 'version', 'integrity', 'provider', 'providerName', 'skills'],
  'npm-mcp-server': [...COMMON_FIELDS, 'spec', 'version', 'integrity', 'bridge', 'serverName', 'credentialEnv', 'toolCallTimeoutMs', 'reconnect'],
  'openspec-schema': [...COMMON_FIELDS, 'archiveUrl', 'commit', 'archiveSha256', 'treeSha256', 'sourcePath', 'target', 'scope'],
}
const PACKAGE_PIN_FIELDS = new Set(['spec', 'version', 'integrity'])
const RECONNECT_FIELDS = new Set(['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts'])

function mapping(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label}: mapping required`)
  return value
}

function noUnknown(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`)
  }
}

export function parseExactNpmSpec(spec) {
  if (typeof spec !== 'string') return undefined
  const match = spec.match(/^(@[^/@]+\/[^/@]+|[^/@]+)@([^@]+)$/)
  if (match === null || !PACKAGE_NAME.test(match[1]) || !EXACT_VERSION.test(match[2])) return undefined
  return { name: match[1], version: match[2] }
}

function packagePin(value, label, expectedName) {
  mapping(value, label)
  noUnknown(value, [...PACKAGE_PIN_FIELDS], label)
  const parsed = parseExactNpmSpec(value.spec)
  if (parsed === undefined) throw new Error(`${label}.spec: exact registry npm spec required (name@version); ranges, tags, URLs and local paths are forbidden`)
  if (typeof value.version !== 'string' || value.version !== parsed.version) throw new Error(`${label}.version: must exactly match ${value.spec}`)
  if (!SHA512.test(value.integrity ?? '')) throw new Error(`${label}.integrity: declared sha512 integrity required`)
  if (expectedName !== undefined && parsed.name !== expectedName) throw new Error(`${label}.spec: must pin ${expectedName}`)
  return { spec: value.spec, name: parsed.name, version: parsed.version, integrity: value.integrity }
}

function flatPackagePin(resource, label) {
  return packagePin({ spec: resource.spec, version: resource.version, integrity: resource.integrity }, label)
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}: positive integer required`)
  return value
}

function validateWorkflow(resource, label) {
  const runtime = flatPackagePin(resource, label)
  const provider = packagePin(resource.provider, `${label}.provider`, '@deepseek-ai/dsh-skill-filesystem')
  if (typeof resource.providerName !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(resource.providerName)) {
    throw new Error(`${label}.providerName: stable unique provider name required`)
  }
  if (!Array.isArray(resource.skills) || resource.skills.some((name) => typeof name !== 'string')) {
    throw new Error(`${label}.skills: fixed skill-name list required`)
  }
  if (JSON.stringify(resource.skills) !== JSON.stringify(SPEC_SUPERFLOW_SKILLS)) {
    throw new Error(`${label}.skills: must list all nine expected spec-superflow skills in upstream order`)
  }
  return { ...resource, enabled: resource.enabled !== false, package: runtime, provider }
}

function validateMcp(resource, label) {
  const runtime = flatPackagePin(resource, label)
  const bridge = packagePin(resource.bridge, `${label}.bridge`, '@deepseek-ai/dsh-mcp-client')
  if (typeof resource.serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(resource.serverName)) {
    throw new Error(`${label}.serverName: [A-Za-z0-9_-]{1,32} required`)
  }
  if (resource.credentialEnv !== 'TYPESAFE_API_KEY') throw new Error(`${label}.credentialEnv: must be TYPESAFE_API_KEY`)
  const toolCallTimeoutMs = positiveInteger(resource.toolCallTimeoutMs, `${label}.toolCallTimeoutMs`)
  const reconnect = mapping(resource.reconnect, `${label}.reconnect`)
  noUnknown(reconnect, [...RECONNECT_FIELDS], `${label}.reconnect`)
  if (typeof reconnect.enabled !== 'boolean') throw new Error(`${label}.reconnect.enabled: boolean required`)
  const normalizedReconnect = {
    enabled: reconnect.enabled,
    initialDelayMs: positiveInteger(reconnect.initialDelayMs, `${label}.reconnect.initialDelayMs`),
    maxDelayMs: positiveInteger(reconnect.maxDelayMs, `${label}.reconnect.maxDelayMs`),
    maxAttempts: positiveInteger(reconnect.maxAttempts, `${label}.reconnect.maxAttempts`),
  }
  if (normalizedReconnect.initialDelayMs > normalizedReconnect.maxDelayMs) {
    throw new Error(`${label}.reconnect: initialDelayMs must not exceed maxDelayMs`)
  }
  return { ...resource, enabled: resource.enabled !== false, package: runtime, bridge, toolCallTimeoutMs, reconnect: normalizedReconnect }
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || value === '' || path.posix.isAbsolute(value) || value.includes('\\')) {
    throw new Error(`${label}: non-empty POSIX relative path required`)
  }
  const normalized = path.posix.normalize(value)
  if (normalized === '..' || normalized.startsWith('../') || normalized !== value || value.split('/').includes('')) {
    throw new Error(`${label}: path must be normalized and must not escape`)
  }
  return value
}

function validateSchema(resource, label) {
  if (typeof resource.archiveUrl !== 'string') throw new Error(`${label}.archiveUrl: exact HTTPS commit archive URL required`)
  let url
  try { url = new URL(resource.archiveUrl) } catch { throw new Error(`${label}.archiveUrl: valid URL required`) }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new Error(`${label}.archiveUrl: exact credential-free HTTPS URL required`)
  }
  if (typeof resource.commit !== 'string' || !COMMIT.test(resource.commit)) throw new Error(`${label}.commit: 40-hex commit required`)
  if (!resource.archiveUrl.includes(resource.commit)) throw new Error(`${label}.archiveUrl: URL must contain the exact commit`)
  if (!SHA256.test(resource.archiveSha256 ?? '')) throw new Error(`${label}.archiveSha256: lowercase sha256 required`)
  if (!SHA256.test(resource.treeSha256 ?? '')) throw new Error(`${label}.treeSha256: lowercase sha256 required`)
  const sourcePath = safeRelative(resource.sourcePath, `${label}.sourcePath`)
  let target = resource.target
  if (typeof target === 'string' && target.startsWith('openspec/schemas/')) target = target.slice('openspec/schemas/'.length)
  if (typeof target !== 'string' || !SAFE_TARGET.test(target)) throw new Error(`${label}.target: safe schema name required`)
  const scope = resource.scope ?? 'user'
  if (!['user', 'project'].includes(scope)) throw new Error(`${label}.scope: must be user or project`)
  return { ...resource, target, scope, sourcePath, enabled: resource.enabled !== false }
}

/** Validate the complete top-level resource surface without side effects. */
export function validateThirdPartyResources(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('manifest: thirdPartyResources must be a list')
  const ids = new Set()
  const providerNames = new Set()
  const serverNames = new Set()
  const packagePinsByName = new Map()
  const targets = new Set()
  return value.map((raw, index) => {
    const label = `thirdPartyResources[${index}]`
    const resource = mapping(raw, label)
    if (typeof resource.id !== 'string' || !ID.test(resource.id)) throw new Error(`${label}: valid id required`)
    if (ids.has(resource.id)) throw new Error(`${label}: duplicate id ${resource.id}`)
    ids.add(resource.id)
    if (!RESOURCE_TYPES.has(resource.type)) throw new Error(`${label} (${resource.id}): type must be npm-workflow|npm-mcp-server|openspec-schema`)
    noUnknown(resource, FIELDS[resource.type], `${label} (${resource.id})`)
    if (resource.enabled !== undefined && typeof resource.enabled !== 'boolean') throw new Error(`${label} (${resource.id}).enabled: boolean required`)
    const normalized = resource.type === 'npm-workflow'
      ? validateWorkflow(resource, `${label} (${resource.id})`)
      : resource.type === 'npm-mcp-server'
        ? validateMcp(resource, `${label} (${resource.id})`)
        : validateSchema(resource, `${label} (${resource.id})`)
    for (const pin of [normalized.package, normalized.provider, normalized.bridge].filter(Boolean)) {
      const previous = packagePinsByName.get(pin.name)
      if (previous !== undefined && (previous.spec !== pin.spec || previous.integrity !== pin.integrity)) {
        throw new Error(`${label} (${resource.id}): package ${pin.name} has conflicting exact pins`)
      }
      packagePinsByName.set(pin.name, pin)
    }
    if (normalized.providerName !== undefined) {
      if (providerNames.has(normalized.providerName)) throw new Error(`${label} (${resource.id}): duplicate providerName ${normalized.providerName}`)
      providerNames.add(normalized.providerName)
    }
    if (normalized.serverName !== undefined) {
      if (serverNames.has(normalized.serverName)) throw new Error(`${label} (${resource.id}): duplicate serverName ${normalized.serverName}`)
      serverNames.add(normalized.serverName)
    }
    if (normalized.target !== undefined) {
      if (targets.has(normalized.target)) throw new Error(`${label} (${resource.id}): duplicate schema target ${normalized.target}`)
      targets.add(normalized.target)
    }
    return normalized
  })
}

export function resourcePackageItems(resources) {
  const out = []
  const byName = new Map()
  for (const resource of resources) {
    if (resource.type === 'openspec-schema') continue
    const pins = resource.type === 'npm-workflow'
      ? [['runtime', resource.package], ['provider', resource.provider]]
      : [['runtime', resource.package], ['bridge', resource.bridge]]
    for (const [role, pin] of pins) {
      const previous = byName.get(pin.name)
      if (previous !== undefined) {
        if (previous.spec !== pin.spec || previous.integrity !== pin.integrity) {
          throw new Error(`third-party package ${pin.name} has conflicting exact pins`)
        }
        previous.enabled ||= resource.enabled
        previous.thirdPartyResources.push(resource.id)
        continue
      }
      const item = {
        id: `third-party-${resource.id}-${role}`,
        type: 'package',
        source: 'remote',
        spec: pin.spec,
        version: pin.version,
        enabled: resource.enabled,
        thirdPartyResources: [resource.id],
      }
      byName.set(pin.name, item)
      out.push(item)
    }
  }
  return out
}

export function packagePins(resources, { enabledOnly = true } = {}) {
  const byName = new Map()
  for (const resource of resources.filter((candidate) => !enabledOnly || candidate.enabled)) {
    for (const pin of [resource.package, resource.provider, resource.bridge].filter(Boolean)) byName.set(pin.name, pin)
  }
  return [...byName.values()]
}

export function resolveNpmIntegrity(pin) {
  const result = spawnSync('npm', ['view', pin.spec, 'dist.integrity', '--json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`cannot resolve npm integrity for ${pin.spec}`)
  let value
  try { value = JSON.parse(result.stdout) } catch { throw new Error(`invalid npm integrity response for ${pin.spec}`) }
  if (typeof value !== 'string') throw new Error(`npm registry returned no integrity for ${pin.spec}`)
  return value
}

/** Resolve every exact package identity before installation or materialization. */
export async function preflightResourceIntegrities(resources, { resolver = resolveNpmIntegrity } = {}) {
  for (const pin of packagePins(resources)) {
    const actual = await resolver(pin)
    if (actual !== pin.integrity) throw new Error(`third-party resource integrity mismatch for ${pin.spec}: declared ${pin.integrity}, registry ${actual}`)
  }
}

function installedPackageDir(profileDir, name) {
  return path.join(profileDir, 'node_modules', ...name.split('/'))
}

async function installedPinHealthy(profileDir, pin) {
  const file = path.join(installedPackageDir(profileDir, pin.name), 'package.json')
  try {
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    return pkg.name === pin.name && pkg.version === pin.version
  } catch {
    return false
  }
}

export async function resourceHealth(resources, { profileDir, managedAssetsDir }) {
  const health = {}
  for (const resource of resources) {
    if (!resource.enabled) {
      health[resource.id] = false
      continue
    }
    if (resource.type === 'npm-workflow') {
      let ok = await installedPinHealthy(profileDir, resource.package) && await installedPinHealthy(profileDir, resource.provider)
      const root = installedPackageDir(profileDir, resource.package.name)
      // The workflow's actual CLI runtime (both upstream bin aliases point
      // here), not merely its library entry, must accompany all nine skills.
      ok &&= existsSync(path.join(root, 'scripts', 'spec-superflow.mjs'))
      for (const skill of resource.skills) ok &&= existsSync(path.join(root, 'skills', skill, 'SKILL.md'))
      health[resource.id] = ok
    } else if (resource.type === 'npm-mcp-server') {
      const launcher = path.join(managedAssetsDir, `${resource.id}-launcher.mjs`)
      health[resource.id] = await installedPinHealthy(profileDir, resource.package) &&
        await installedPinHealthy(profileDir, resource.bridge) &&
        existsSync(path.join(installedPackageDir(profileDir, resource.package.name), 'dist', 'index.js')) &&
        existsSync(launcher)
    } else {
      health[resource.id] = true
    }
  }
  return health
}

function q(value) {
  return JSON.stringify(value)
}

export function renderResourcePatch(resources, { profileDir, managedAssetsDir, health = {} }) {
  const parts = []
  for (const resource of resources) {
    if (!resource.enabled || health[resource.id] !== true) continue
    if (resource.type === 'npm-workflow') {
      const skills = path.join(installedPackageDir(profileDir, resource.package.name), 'skills')
      parts.push([
        `# --- third-party resource: ${resource.id} ---`,
        '- insert:',
        `    - id: ${q(`third-party-${resource.id}-skills`)}`,
        `      name: ${q(resource.provider.name)}`,
        '      config:',
        `        providerName: ${q(resource.providerName)}`,
        '        includeDefaultRoots: false',
        '        watch: false',
        `        bundledSkillDir: ${q(skills)}`,
      ].join('\n'))
    } else if (resource.type === 'npm-mcp-server') {
      const launcher = path.join(managedAssetsDir, `${resource.id}-launcher.mjs`)
      parts.push([
        `# --- third-party resource: ${resource.id} ---`,
        '- insert:',
        `    - id: ${q(`third-party-${resource.id}-bridge`)}`,
        `      name: ${q(resource.bridge.name)}`,
        `      disabled: !!js >-`,
        `        !process.env.${resource.credentialEnv}`,
        '      config:',
        `        serverName: ${q(resource.serverName)}`,
        '        transport: stdio',
        '        command: !!js process.execPath',
        `        args: [${q(launcher)}]`,
        '        env:',
        `          ${resource.credentialEnv}: !!js process.env.${resource.credentialEnv}`,
        `        toolCallTimeoutMs: ${resource.toolCallTimeoutMs}`,
        '        failOnStartupError: false',
        '        reconnect:',
        `          enabled: ${resource.reconnect.enabled}`,
        `          initialDelayMs: ${resource.reconnect.initialDelayMs}`,
        `          maxDelayMs: ${resource.reconnect.maxDelayMs}`,
        `          maxAttempts: ${resource.reconnect.maxAttempts}`,
      ].join('\n'))
    }
  }
  return parts
}

export function renderMcpLauncher(entryFile) {
  return `#!/usr/bin/env node
import { spawn } from 'node:child_process'

const key = process.env.TYPESAFE_API_KEY
if (!key) process.exit(78)
const child = spawn(process.execPath, [${JSON.stringify(entryFile)}], {
  stdio: 'inherit',
  env: { TYPESAFE_API_KEY: key, JEV_PROVIDER: 'typesafe' },
})
let forwarding = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (forwarding) return
    forwarding = true
    if (!child.killed) child.kill(signal)
  })
}
child.once('error', () => process.exit(1))
child.once('exit', (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
`
}

async function hashFile(file, algorithm = 'sha256') {
  return createHash(algorithm).update(await readFile(file)).digest('hex')
}

export async function selectedTreeHash(root) {
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (entry.isSymbolicLink()) throw new Error(`schema tree contains symbolic link: ${rel}`)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) files.push(rel)
      else throw new Error(`schema tree contains unsupported entry: ${rel}`)
    }
  }
  await walk(root)
  const hash = createHash('sha256')
  for (const rel of files.sort()) {
    hash.update(rel)
    hash.update('\0')
    hash.update(await readFile(path.join(root, ...rel.split('/'))))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function safeArchiveEntry(raw) {
  const entry = raw.replace(/\/$/, '')
  if (entry === '') return true
  if (entry.includes('\\') || path.posix.isAbsolute(entry)) return false
  const normalized = path.posix.normalize(entry)
  return normalized === entry && normalized !== '..' && !normalized.startsWith('../') && !entry.split('/').includes('')
}

export function validateTarListing(text) {
  const entries = text.split(/\r?\n/).filter(Boolean)
  if (entries.length === 0) throw new Error('schema archive is empty')
  for (const entry of entries) if (!safeArchiveEntry(entry)) throw new Error(`unsafe schema archive path: ${entry}`)
  const roots = new Set(entries.map((entry) => entry.replace(/\/$/, '').split('/')[0]))
  if (roots.size !== 1) throw new Error('schema archive must contain exactly one root directory')
  return [...roots][0]
}

async function defaultFetchArchive(url, destination) {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`schema archive fetch failed (${response.status})`)
  await writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

async function defaultExtractArchive(archive, destination) {
  const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  if (listed.status !== 0) throw new Error('cannot list schema archive')
  validateTarListing(listed.stdout)
  // Reject links and special files before extraction; checking only afterward
  // is too late because a link followed by another member could write outside
  // the temporary root on a permissive tar implementation.
  const verbose = spawnSync('tar', ['-tvzf', archive], { encoding: 'utf8' })
  if (verbose.status !== 0) throw new Error('cannot inspect schema archive entry types')
  for (const line of verbose.stdout.split(/\r?\n/).filter(Boolean)) {
    if (!['-', 'd'].includes(line[0])) throw new Error('schema archive contains a link or special file')
  }
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', destination, '--no-same-owner', '--no-same-permissions'], { encoding: 'utf8' })
  if (extracted.status !== 0) throw new Error('cannot extract schema archive')
}

async function assertSafeExtractedTree(root) {
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const metadata = await lstat(full)
      if (metadata.isSymbolicLink()) throw new Error(`schema archive contains symbolic link: ${path.relative(root, full)}`)
      if (metadata.isDirectory()) await walk(full)
      else if (!metadata.isFile()) throw new Error(`schema archive contains unsupported entry: ${path.relative(root, full)}`)
    }
  }
  await walk(root)
}

async function atomicReplaceDirectory(source, target) {
  await mkdir(path.dirname(target), { recursive: true })
  const staged = `${target}.ohmydsh-new-${process.pid}`
  const backup = `${target}.ohmydsh-old-${process.pid}`
  await rm(staged, { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  await cp(source, staged, { recursive: true, errorOnExist: true })
  let movedOld = false
  try {
    if (existsSync(target)) {
      await rename(target, backup)
      movedOld = true
    }
    await rename(staged, target)
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(staged, { recursive: true, force: true })
    if (movedOld && !existsSync(target)) await rename(backup, target)
    throw error
  }
}

/** Materialize/remove exact schema resources with drift-safe ledger ownership. */
export async function syncSchemaResources(resources, {
  repo,
  userSchemasDir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'openspec', 'schemas'),
  state,
  fetchArchive = defaultFetchArchive,
  extractArchive = defaultExtractArchive,
  onChange = () => {},
  onLog = () => {},
}) {
  state.thirdPartySchemas ??= {}
  const schemas = resources.filter((resource) => resource.type === 'openspec-schema')
  const schemaTarget = (scope, name) => scope === 'project'
    ? path.join(repo, 'openspec', 'schemas', name)
    : path.join(userSchemasDir, name)
  const current = new Set(schemas.map((resource) => resource.id))
  for (const [id, record] of Object.entries(state.thirdPartySchemas)) {
    const resource = schemas.find((candidate) => candidate.id === id)
    const recordScope = record.scope ?? 'project'
    if (resource?.enabled && resource.target === record.target && resource.scope === recordScope) continue
    const target = schemaTarget(recordScope, record.target)
    if (existsSync(target)) {
      const actual = await selectedTreeHash(target)
      if (actual !== record.deployedHash) throw new Error(`third-party schema ${id} drift at ${target}; refusing to remove`)
      await rm(target, { recursive: true })
      onChange(`remove third-party schema ${id}`)
    }
    delete state.thirdPartySchemas[id]
  }
  for (const id of Object.keys(state.thirdPartySchemas)) {
    if (!current.has(id)) delete state.thirdPartySchemas[id]
  }
  for (const resource of schemas.filter((candidate) => candidate.enabled)) {
    const target = schemaTarget(resource.scope, resource.target)
    const record = state.thirdPartySchemas[resource.id]
    if (existsSync(target)) {
      const actual = await selectedTreeHash(target)
      if (record === undefined) throw new Error(`third-party schema target ${target} is unmanaged; refusing to overwrite`)
      if (actual !== record.deployedHash) throw new Error(`third-party schema ${resource.id} drift at ${target}; refusing to overwrite`)
      if (actual === resource.treeSha256 && record.sourceIdentity === `${resource.commit}:${resource.archiveSha256}`) {
        onLog(`third-party schema ${resource.id} up-to-date`)
        continue
      }
    }
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ohmydsh-schema-'))
    try {
      const archive = path.join(temp, 'source.tgz')
      const extracted = path.join(temp, 'extracted')
      await mkdir(extracted)
      await fetchArchive(resource.archiveUrl, archive, resource)
      if (await hashFile(archive) !== resource.archiveSha256) throw new Error(`third-party schema ${resource.id}: archive sha256 mismatch`)
      await extractArchive(archive, extracted, resource)
      const roots = await readdir(extracted)
      if (roots.length !== 1) throw new Error(`third-party schema ${resource.id}: archive must extract to one root`)
      const root = path.join(extracted, roots[0])
      const rootStat = await lstat(root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`third-party schema ${resource.id}: unsafe archive root`)
      await assertSafeExtractedTree(root)
      const source = path.resolve(root, ...resource.sourcePath.split('/'))
      const relative = path.relative(root, source)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`third-party schema ${resource.id}: sourcePath escapes archive root`)
      const sourceStat = await lstat(source).catch(() => undefined)
      if (sourceStat === undefined || !sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`third-party schema ${resource.id}: sourcePath is not a directory`)
      const treeHash = await selectedTreeHash(source)
      if (treeHash !== resource.treeSha256) throw new Error(`third-party schema ${resource.id}: selected tree sha256 mismatch`)
      await atomicReplaceDirectory(source, target)
      state.thirdPartySchemas[resource.id] = {
        target: resource.target,
        scope: resource.scope,
        deployedHash: treeHash,
        sourceIdentity: `${resource.commit}:${resource.archiveSha256}`,
      }
      onChange(`install third-party schema ${resource.id} -> ${resource.scope} schema ${resource.target}`)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  }
}

/** Generate/remove strict MCP launchers under DSH_HOME with ownership checks. */
export async function syncManagedLaunchers(resources, { profileDir, managedAssetsDir, state, onChange = () => {}, onLog = () => {} }) {
  state.thirdPartyLaunchers ??= {}
  const desired = new Map(resources.filter((r) => r.type === 'npm-mcp-server' && r.enabled).map((r) => [r.id, r]))
  for (const [id, record] of Object.entries(state.thirdPartyLaunchers)) {
    if (desired.has(id)) continue
    const target = path.join(managedAssetsDir, `${id}-launcher.mjs`)
    if (existsSync(target)) {
      const actual = await hashFile(target)
      if (actual !== record.deployedHash) throw new Error(`managed launcher ${id} drift at ${target}; refusing to remove`)
      await rm(target)
      onChange(`remove managed launcher ${id}`)
    }
    delete state.thirdPartyLaunchers[id]
  }
  for (const [id, resource] of desired) {
    const entry = path.join(installedPackageDir(profileDir, resource.package.name), 'dist', 'index.js')
    if (!existsSync(entry)) continue
    const target = path.join(managedAssetsDir, `${id}-launcher.mjs`)
    const content = renderMcpLauncher(entry)
    const desiredHash = createHash('sha256').update(content).digest('hex')
    const record = state.thirdPartyLaunchers[id]
    if (existsSync(target)) {
      const actual = await hashFile(target)
      if (record === undefined) throw new Error(`managed launcher target ${target} is unmanaged; refusing to overwrite`)
      if (actual !== record.deployedHash) throw new Error(`managed launcher ${id} drift at ${target}; refusing to overwrite`)
      if (actual === desiredHash) {
        onLog(`managed launcher ${id} up-to-date`)
        continue
      }
    }
    await mkdir(managedAssetsDir, { recursive: true })
    const temp = `${target}.tmp-${process.pid}`
    await writeFile(temp, content, { mode: 0o700 })
    await rename(temp, target)
    state.thirdPartyLaunchers[id] = { deployedHash: desiredHash }
    onChange(`generate managed launcher ${id}`)
  }
}
