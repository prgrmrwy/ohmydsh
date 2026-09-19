#!/usr/bin/env node
/** Build the fixed-source Pet-only lark-cli bounded inherited-fd seam. */
import { createHash } from 'node:crypto'
import {
  chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync,
  rmSync, statSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const requireHere = createRequire(import.meta.url)
const { runCompatCommand } = requireHere('../subagent/compat-run.cjs')
const { acquireCompatBuildLock } = requireHere('../subagent/compat-build-lock.cjs')
const compatBuildLock = acquireCompatBuildLock()
process.once('exit', () => compatBuildLock.release())
const patchFile = join(here, 'bounded-fd-download.patch')
const checkout = join(here, '.upstream')
const artifact = join(here, 'artifact')
const artifactBuilds = join(here, '.artifact-builds')
const toolchainRoot = join(here, '.toolchains')
const upstream = {
  repository: 'https://github.com/larksuite/cli.git',
  tag: 'v1.0.94',
  version: '1.0.94',
  commit: 'f065bf5b645af381f9b7475ce721451e6ca36a23',
  patchSha256: '3c8b66745b20f44d2f88e86342df15294e13779eeb0d78ceddcb2511419aea7c',
}
const goVersion = '1.23.12'
const toolchainHashes = {
  'darwin-amd64': '0f6efdc3ffc6f03b230016acca0aef43c229de022d0ff401e7aa4ad4862eca8e',
  'darwin-arm64': '5bfa117e401ae64e7ffb960243c448b535fe007e682a13ff6c7371f4a6f0ccaa',
  'linux-amd64': 'd3847fef834e9db11bf64e3fb34db9c04db14e068eeb064f49af747010454f90',
  'linux-arm64': '52ce172f96e21da53b1ae9079808560d49b02ac86cecfa457217597f9bc28ab3',
}
const toolchains = Object.fromEntries(Object.entries(toolchainHashes).map(([key, sha256]) => [key, {
  version: goVersion,
  url: `https://go.dev/dl/go${goVersion}.${key}.tar.gz`,
  sha256,
}]))

function fail(message) { throw new Error(`[compat/lark-cli] ${message}`) }
function sha256(file) { return createHash('sha256').update(readFileSync(file)).digest('hex') }
function run(command, args, cwd = here, options) { return runCompatCommand(command, args, cwd, options) }
function capture(command, args, cwd = here, options = {}) { return run(command, args, cwd, { ...options, capture: true }) }

async function ensureToolchain(spec, key) {
  const archive = join(toolchainRoot, `go${spec.version}.${key}.tar.gz`)
  const extracted = join(toolchainRoot, `go${spec.version}-${key}`)
  const go = join(extracted, 'go', 'bin', 'go')
  if (existsSync(go)) return go
  mkdirSync(toolchainRoot, { recursive: true })
  if (!existsSync(archive) || sha256(archive) !== spec.sha256) {
    rmSync(archive, { force: true })
    const response = await fetch(spec.url, { redirect: 'follow' })
    if (!response.ok || response.body === null) fail(`download Go ${spec.version} failed: HTTP ${response.status}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { mode: 0o600 }))
  }
  if (sha256(archive) !== spec.sha256) fail(`Go ${spec.version} archive hash mismatch for ${key}`)
  rmSync(extracted, { recursive: true, force: true })
  mkdirSync(extracted, { recursive: true })
  run('tar', ['-xzf', archive, '-C', extracted])
  if (!existsSync(go)) fail(`Go ${spec.version} archive produced no go binary`)
  return go
}

function validArtifact(fingerprint) {
  try {
    const provenance = JSON.parse(readFileSync(join(artifact, 'provenance.json'), 'utf8'))
    const binary = join(artifact, 'lark-cli')
    return readFileSync(join(artifact, '.fingerprint'), 'utf8').trim() === fingerprint
      && statSync(binary).isFile() && (statSync(binary).mode & 0o111) !== 0
      && provenance.upstreamVersion === upstream.version
      && provenance.upstreamCommit === upstream.commit
      && provenance.patchSha256 === upstream.patchSha256
      && provenance.platform === process.platform && provenance.arch === process.arch
      && provenance.supportsBoundedFdDownload === true
      && provenance.binarySha256 === sha256(binary)
  } catch { return false }
}

try {
  if (process.platform === 'win32') fail('bounded inherited-fd download requires POSIX')
  const platformKey = `${process.platform}-${process.arch}`
  const toolchain = toolchains[platformKey]
  if (toolchain === undefined) fail(`no reviewed Go toolchain hash for ${platformKey}`)
  if (sha256(patchFile) !== upstream.patchSha256) fail('patch hash mismatch')
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(upstream)).update(JSON.stringify(toolchain))
    .update(readFileSync(patchFile)).update(readFileSync(fileURLToPath(import.meta.url)))
    .digest('hex')
  if (validArtifact(fingerprint)) {
    console.log('[compat/lark-cli] up-to-date')
    process.exit(0)
  }

  const go = await ensureToolchain(toolchain, platformKey)
  if (!existsSync(join(checkout, '.git'))) {
    rmSync(checkout, { recursive: true, force: true })
    run('git', ['clone', '--depth', '1', '--branch', upstream.tag, upstream.repository, checkout])
  }
  run('git', ['reset', '--hard'], checkout)
  run('git', ['clean', '-fd'], checkout)
  run('git', ['checkout', '--detach', upstream.commit], checkout)
  const head = capture('git', ['rev-parse', 'HEAD'], checkout).trim()
  if (head !== upstream.commit) fail(`reviewed upstream commit mismatch: ${head}`)
  run('git', ['apply', '--check', patchFile], checkout)
  run('git', ['apply', patchFile], checkout)

  const cacheRoot = join(here, '.cache')
  const goEnv = {
    GOTOOLCHAIN: 'local', CGO_ENABLED: '0', GOOS: process.platform === 'darwin' ? 'darwin' : 'linux',
    GOARCH: process.arch === 'arm64' ? 'arm64' : 'amd64',
    GOCACHE: join(cacheRoot, 'go-build'), GOMODCACHE: join(cacheRoot, 'go-mod'),
  }
  console.log('[compat/lark-cli] running focused Go unit tests')
  run(go, ['test', './shortcuts/im', '-run', 'Test(ParseIMResourceFDMode|DownloadIMResourceToFD)', '-count=1'], checkout, { env: goEnv })
  const staging = join(here, `.artifact.staging-${process.pid}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const binary = join(staging, 'lark-cli')
  const ldflags = `-s -w -buildid= -X github.com/larksuite/cli/internal/build.Version=v${upstream.version}-dsh-pet-bounded-fd.1 -X github.com/larksuite/cli/internal/build.Date=2026-09-18`
  run(go, ['build', '-trimpath', '-ldflags', ldflags, '-o', binary, '.'], checkout, { env: goEnv })
  chmodSync(binary, 0o755)
  const binarySource = readFileSync(binary)
  for (const marker of ['output-fd', 'max-bytes', 'resource exceeds --max-bytes']) {
    if (!binarySource.includes(Buffer.from(marker))) fail(`built binary lacks capability marker ${marker}`)
  }
  const reported = capture(binary, ['--version'], checkout).trim()
  if (!reported.includes(`v${upstream.version}-dsh-pet-bounded-fd.1`)) fail(`unexpected binary version: ${reported}`)
  writeFileSync(join(staging, 'provenance.json'), `${JSON.stringify({
    upstreamVersion: upstream.version,
    upstreamTag: upstream.tag,
    upstreamCommit: upstream.commit,
    patchSha256: upstream.patchSha256,
    goVersion: toolchain.version,
    goArchiveSha256: toolchain.sha256,
    platform: process.platform,
    arch: process.arch,
    supportsBoundedFdDownload: true,
    binarySha256: sha256(binary),
  }, null, 2)}\n`)
  writeFileSync(join(staging, '.fingerprint'), `${fingerprint}\n`)
  mkdirSync(artifactBuilds, { recursive: true })
  const generation = `${fingerprint}-${Date.now()}`
  const built = join(artifactBuilds, generation)
  renameSync(staging, built)
  // npm excludes symlinked package contents, so publish a real directory while
  // retaining the previous complete generation until the replacement succeeds.
  const previous = join(here, `.artifact.previous-${process.pid}`)
  rmSync(previous, { recursive: true, force: true })
  if (existsSync(artifact)) renameSync(artifact, previous)
  try {
    renameSync(built, artifact)
    if (!validArtifact(fingerprint)) fail('published artifact failed provenance verification')
    rmSync(previous, { recursive: true, force: true })
  } catch (error) {
    rmSync(artifact, { recursive: true, force: true })
    if (existsSync(previous)) renameSync(previous, artifact)
    throw error
  }
  console.log(`[compat/lark-cli] ready: ${join(artifact, 'lark-cli')}`)
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
} finally {
  compatBuildLock.release()
}
