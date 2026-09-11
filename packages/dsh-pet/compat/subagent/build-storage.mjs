#!/usr/bin/env node
/** Build fixed-source atomic storage packages for the Pet locus domain. */
import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)
const compatBuildLock = requireHere('./compat-build-lock.cjs').acquireCompatBuildLock()
const { runCompatCommand } = requireHere('./compat-run.cjs')
process.once('exit', () => compatBuildLock.release())
const checkout = join(here, '.storage-upstream')
const artifacts = join(here, 'storage-artifacts')
const artifactBuilds = join(here, '.storage-artifact-builds')
const patchFile = join(here, 'storage-atomic.patch')
const tag = 'dsh-v0.1.2-rc.1'
const reviewedCommit = 'a66e4702047846cdaa10c66c9d3df3951f5ea70d'
const patchSha256 = '18ec93c5240612b513871d65db2d100ee6165ea1ba251dbf91e670963dd35bed'
const packages = [
  ['storage/storage', 'storage'],
  ['storage/storage-domain', 'storage-domain'],
  ['storage/storage-sqlite', 'storage-sqlite'],
  ['storage/storage-json', 'storage-json'],
]

function run(command, args, cwd) {
  return runCompatCommand(command, args, cwd)
}
function fail(message) {
  throw new Error(`[compat/storage] ${message}`)
}
function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
function walkPackageJson(root, result = new Map()) {
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue
    const candidate = join(root, name)
    if (!statSync(candidate).isDirectory()) continue
    const manifest = join(candidate, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') result.set(pkg.name, pkg.version)
    }
    walkPackageJson(candidate, result)
  }
  return result
}
function publish(targetRoot, sourceRel, targetName, versions, head) {
  const source = join(checkout, 'packages', sourceRel)
  const target = join(targetRoot, targetName)
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'lib'), join(target, 'lib'), { recursive: true })
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        const version = versions.get(name)
        if (version === undefined) fail(`cannot resolve workspace version for ${name}`)
        pkg[section][name] = `^${version}`
      }
    }
  }
  delete pkg.devDependencies
  delete pkg.publishConfig
  pkg.version = `${pkg.version}-locus-atomic.1`
  pkg.dsh_compat = {
    replaces: `${pkg.name}@0.1.2-rc.1`,
    upstreamTag: tag,
    upstreamBase: head,
    patchSha256,
  }
  writeFileSync(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
}
function validArtifactSet(root, fingerprint) {
  try {
    if (readFileSync(join(root, '.fingerprint'), 'utf8').trim() !== fingerprint) return false
    for (const [, name] of packages) {
      const pkg = JSON.parse(readFileSync(join(root, name, 'package.json'), 'utf8'))
      if (!existsSync(join(root, name, 'lib', 'index.js'))) return false
      if (pkg.dsh_compat?.patchSha256 !== patchSha256) return false
      if (pkg.dsh_compat?.upstreamBase !== reviewedCommit) return false
      if (pkg.dsh_compat?.replaces !== `${pkg.name}@0.1.2-rc.1`) return false
    }
    const domain = readFileSync(join(root, 'storage-domain', 'lib', 'index.js'), 'utf8')
    const json = readFileSync(join(root, 'storage-json', 'lib', 'index.js'), 'utf8')
    const sqlite = readFileSync(join(root, 'storage-sqlite', 'lib', 'index.js'), 'utf8')
    const storageTypes = readFileSync(join(root, 'storage', 'lib', 'types', 'backend.d.ts'), 'utf8')
    return domain.includes('transaction-unsupported') && domain.includes('applyBatch')
      && json.includes('applyBatch') && sqlite.includes('applyBatch')
      && sqlite.includes('exclusive write lock') && storageTypes.includes('applyBatch?')
  } catch {
    return false
  }
}

try {
if (hashFile(patchFile) !== patchSha256) fail('storage patch hash mismatch')
const fingerprint = createHash('sha256')
  .update(tag)
  .update(readFileSync(patchFile))
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .update(readFileSync(join(here, 'compat-build-lock.cjs')))
  .update(readFileSync(join(here, 'compat-run.cjs')))
  .digest('hex')
if (validArtifactSet(artifacts, fingerprint)) {
  console.log('[compat/storage] up-to-date')
} else {

if (!existsSync(join(checkout, '.git'))) {
  rmSync(checkout, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', tag, 'https://github.com/deepseek-ai/deepseek-harness.git', checkout], here)
}
run('git', ['checkout', '--detach', reviewedCommit], checkout)
run('git', ['checkout', '--', '.'], checkout)
run('git', ['apply', '--check', patchFile], checkout)
run('git', ['apply', patchFile], checkout)
run('corepack', ['pnpm', 'install', '--prefer-offline'], checkout)
run('corepack', ['pnpm', 'run', 'build:lib:host'], checkout)

const versions = walkPackageJson(join(checkout, 'packages'))
walkPackageJson(join(checkout, 'vendor'), versions)
const head = runCompatCommand('git', ['rev-parse', 'HEAD'], checkout, { capture: true }).trim()
if (head !== reviewedCommit) fail(`reviewed upstream commit mismatch: ${head}`)
const staging = join(here, `.storage-artifacts.staging-${process.pid}-${randomUUID()}`)
const nextLink = join(here, `.storage-artifacts.next-${process.pid}-${randomUUID()}`)
const previousEntity = join(here, `.storage-artifacts.previous-${process.pid}-${randomUUID()}`)
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
try {
  for (const [source, target] of packages) publish(staging, source, target, versions, head)
  writeFileSync(join(staging, '.fingerprint'), `${fingerprint}\n`)
  if (!validArtifactSet(staging, fingerprint)) fail('staged storage artifacts failed provenance verification')
  mkdirSync(artifactBuilds, { recursive: true })
  const generation = `${fingerprint}-${randomUUID()}`
  const buildDir = join(artifactBuilds, generation)
  renameSync(staging, buildDir)
  symlinkSync(join('.storage-artifact-builds', generation), nextLink, 'dir')

  let movedLegacyDirectory = false
  let previousLinkTarget
  try {
    if (existsSync(artifacts) && lstatSync(artifacts).isSymbolicLink()) {
      previousLinkTarget = readlinkSync(artifacts)
    } else if (existsSync(artifacts)) {
      renameSync(artifacts, previousEntity)
      movedLegacyDirectory = true
    }
    renameSync(nextLink, artifacts)
    if (!validArtifactSet(artifacts, fingerprint)) fail('published storage artifact pointer failed verification')
    rmSync(previousEntity, { recursive: true, force: true })
    const activeTarget = realpathSync(artifacts)
    const candidates = readdirSync(artifactBuilds).map(name => join(artifactBuilds, name))
      .filter(candidate => candidate !== activeTarget)
      .sort((a, b) => lstatSync(b).mtimeMs - lstatSync(a).mtimeMs)
    for (const stale of candidates.slice(1)) rmSync(stale, { recursive: true, force: true })
  } catch (error) {
    rmSync(nextLink, { force: true })
    if (previousLinkTarget !== undefined) {
      const restoreLink = join(here, `.storage-artifacts.restore-${process.pid}-${randomUUID()}`)
      symlinkSync(previousLinkTarget, restoreLink, 'dir')
      renameSync(restoreLink, artifacts)
    } else if (movedLegacyDirectory) {
      rmSync(artifacts, { force: true })
      if (existsSync(previousEntity)) renameSync(previousEntity, artifacts)
    }
    throw error
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
console.log('[compat/storage] ready')
}
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
} finally {
  compatBuildLock.release()
}
