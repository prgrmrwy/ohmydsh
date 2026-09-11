// Declarative Host-only DSH runtime compatibility owned by dsh-pet.
//
// Deliberately separate from dsh-cli.mjs: build/plugin/dump-config resolve the
// official exact pin, while only the long-lived `dsh web` Host may use this
// reviewed transitive-dependency overlay.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { runBoundedProvision } from './dsh-cli.mjs'

const PET_LOCUS_KIND = 'pet-unified-locus-v1'
const ALLOWED_KEYS = new Set(['kind', 'supportedDshVersion'])

function envBoolean(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function customizationEnabled(item, env) {
  let enabled = item.enabled !== false
  if (typeof item.enabledEnv === 'string') {
    const override = envBoolean(env[item.enabledEnv])
    if (override !== undefined) enabled = override
  }
  return enabled
}

function fixedPetLocusRuntime(repo, version) {
  const packageRoot = path.join(repo, 'packages', 'dsh-pet')
  const compatRoot = path.join(packageRoot, 'compat', 'subagent')
  return {
    ownerId: 'dsh-pet',
    kind: PET_LOCUS_KIND,
    version,
    packageRoot,
    compatRoot,
    builder: path.join(compatRoot, 'build-launcher.cjs'),
    serverBin: path.join(compatRoot, '.launcher', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  }
}

/** Parse the one supported, customization-owned Host runtime declaration. */
export function declaredHostRuntimeFromManifest(doc, { repo, env = process.env } = {}) {
  if (typeof doc !== 'object' || doc === null) throw new Error('manifest: root must be a mapping')
  if (typeof doc.dshVersion !== 'string' || doc.dshVersion === '') throw new Error('manifest: dshVersion is required')
  if (!Array.isArray(doc.customizations)) throw new Error('manifest: customizations must be a list')
  const owners = doc.customizations.filter(item =>
    item && typeof item === 'object' && item.hostRuntimeCompatibility !== undefined,
  )
  if (owners.length === 0) return null
  if (owners.length > 1) throw new Error('manifest: only one customization may own hostRuntimeCompatibility')

  const owner = owners[0]
  const label = `customization ${String(owner.id)} hostRuntimeCompatibility`
  if (owner.id !== 'dsh-pet' || owner.type !== 'package' || (owner.source ?? 'local') !== 'local') {
    throw new Error(`manifest: ${label} is currently supported only on local package dsh-pet`)
  }
  if (!customizationEnabled(owner, env)) return null
  const declaration = owner.hostRuntimeCompatibility
  if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
    throw new Error(`manifest: ${label} must be a mapping`)
  }
  for (const key of Object.keys(declaration)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`manifest: ${label}.${key} is unknown`)
  }
  if (declaration.kind !== PET_LOCUS_KIND) {
    throw new Error(`manifest: ${label}.kind must be ${PET_LOCUS_KIND}`)
  }
  if (typeof declaration.supportedDshVersion !== 'string' || declaration.supportedDshVersion === '') {
    throw new Error(`manifest: ${label}.supportedDshVersion is required`)
  }
  if (declaration.supportedDshVersion !== doc.dshVersion) {
    throw new Error(
      `manifest: ${label} supports DSH ${declaration.supportedDshVersion}, ` +
      `but dshVersion is ${String(doc.dshVersion)}; re-audit or remove the compatibility layer before upgrading`,
    )
  }
  const runtime = fixedPetLocusRuntime(repo, declaration.supportedDshVersion)
  if (!existsSync(runtime.builder) || !statSync(runtime.builder).isFile()) {
    throw new Error(`manifest: ${label} builder is missing from dsh-pet`)
  }
  return runtime
}

export function loadDeclaredHostRuntime({ repo, env = process.env } = {}) {
  const doc = yaml.load(readFileSync(path.join(repo, 'dsh.yaml'), 'utf8'))
  return declaredHostRuntimeFromManifest(doc, { repo, env })
}

function verifiedServerBin(declared) {
  if (!existsSync(declared.serverBin) || !statSync(declared.serverBin).isFile()) {
    throw new Error(`Host runtime compatibility server entry is missing: ${declared.serverBin}`)
  }
  const realPackage = realpathSync(declared.packageRoot)
  const realBin = realpathSync(declared.serverBin)
  const relative = path.relative(realPackage, realBin)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Host runtime compatibility server entry escapes dsh-pet')
  }
  return declared.serverBin
}

/** Build/reuse and verify the declared Host runtime. Never falls back silently. */
export function prepareDeclaredHostRuntime({
  repo,
  env = process.env,
  runner = runBoundedProvision,
  timeoutMs = 600_000,
} = {}) {
  const declared = loadDeclaredHostRuntime({ repo, env })
  if (declared === null) return null
  const built = runner(process.execPath, [declared.builder], {
    cwd: repo,
    env,
    timeoutMs,
    // dsh-server-bin stdout is a machine protocol captured by bin/dsh. Stream
    // builder progress to stderr so a cold build remains visible and cannot
    // corrupt marker parsing.
    stdout: 2,
    stderr: 'inherit',
  })
  if (!built.ok) {
    const suffix = built.timedOut ? ` timed out after ${timeoutMs}ms` : ` exited ${String(built.status)}`
    throw new Error(`Host runtime compatibility builder${suffix}; refusing official-runtime fallback`)
  }
  const bin = verifiedServerBin(declared)
  const probed = runner(process.execPath, [bin, '--version'], {
    cwd: repo,
    env,
    timeoutMs: 30_000,
    stdout: 'pipe',
    stderr: 'inherit',
  })
  if (!probed.ok) throw new Error('Host runtime compatibility version probe failed')
  if (String(probed.stdout ?? '').trim() !== declared.version) {
    throw new Error(
      `Host runtime compatibility reports ${String(probed.stdout ?? '').trim()}, expected ${declared.version}`,
    )
  }
  const fingerprint = readFileSync(path.join(declared.compatRoot, '.launcher', '.fingerprint'), 'utf8').trim()
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Host runtime compatibility fingerprint is missing or invalid')
  return {
    kind: 'customization-host-runtime',
    bin,
    ownerId: declared.ownerId,
    compatibilityKind: declared.kind,
    fingerprint,
    version: declared.version,
  }
}
