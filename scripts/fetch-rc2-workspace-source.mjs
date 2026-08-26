#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const MANIFEST_PATH = path.join(
  REPO,
  'openspec/changes/federated-dsh-control-plane/checking/upstream/rc2-workspace-source-manifest.json',
)

function usage() {
  return `Usage: node scripts/fetch-rc2-workspace-source.mjs [options]\n\n` +
    `Options:\n` +
    `  --cache-dir <path>   Content-addressed cache root (default: XDG cache)\n` +
    `  --output-dir <path>  Replace this directory with the verified source tree\n` +
    `  --offline            Require an existing verified cache entry\n` +
    `  --json               Print a JSON result\n`
}

function parseArgs(argv) {
  const options = { offline: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--offline') options.offline = true
    else if (arg === '--json') options.json = true
    else if (arg === '--cache-dir' || arg === '--output-dir') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a path`)
      options[arg === '--cache-dir' ? 'cacheDir' : 'outputDir'] = path.resolve(value)
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function defaultCacheDir() {
  const root = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')
  return path.join(root, 'ohmydsh', 'dsh-federation', 'workspace-source')
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdoutFile ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => {
      if (options.stdoutFile) options.stdoutFile.write(chunk)
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'))
      else reject(new Error(`${command} exited ${code ?? signal}: ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitBlob(bytes) {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

async function validateArchive(archivePath, manifest) {
  const info = await stat(archivePath)
  if (!info.isFile()) throw new Error(`cache entry is not a regular file: ${archivePath}`)
  const bytes = await readFile(archivePath)
  const digest = sha256(bytes)
  if (digest !== manifest.archive.sha256 || bytes.byteLength !== manifest.archive.size) {
    throw new Error(`workspace source archive mismatch: expected ${manifest.archive.sha256}/${manifest.archive.size}, got ${digest}/${bytes.byteLength}`)
  }
}

async function validateExtracted(root, manifest) {
  for (const entry of manifest.blobs) {
    const target = path.join(root, manifest.archive.prefix, entry.path)
    const bytes = await readFile(target)
    const digest = gitBlob(bytes)
    if (bytes.byteLength !== entry.size || digest !== entry.gitBlob) {
      throw new Error(`workspace source blob mismatch for ${entry.path}`)
    }
  }
}

async function bootstrap(cachePath, manifest) {
  const work = await mkdtemp(path.join(tmpdir(), 'ohmydsh-workspace-source-'))
  const archiveTemp = `${cachePath}.${process.pid}.tmp`
  try {
    await run('git', ['init', '-q'], { cwd: work })
    await run('git', ['remote', 'add', 'origin', manifest.repository], { cwd: work })
    await run('git', ['fetch', '-q', '--depth=1', 'origin', manifest.releaseCommit], { cwd: work })
    const commit = (await run('git', ['rev-parse', 'FETCH_HEAD^{commit}'], { cwd: work })).trim()
    const tree = (await run('git', ['show', '-s', '--format=%T', 'FETCH_HEAD'], { cwd: work })).trim()
    if (commit !== manifest.releaseCommit || tree !== manifest.releaseTree) {
      throw new Error(`upstream identity mismatch: got commit ${commit}, tree ${tree}`)
    }
    for (const entry of manifest.blobs) {
      const row = (await run('git', ['ls-tree', 'FETCH_HEAD', '--', entry.path], { cwd: work })).trim().split(/\s+/)
      if (row[1] !== 'blob' || row[2] !== entry.gitBlob) throw new Error(`upstream Git blob mismatch for ${entry.path}`)
    }
    const { createWriteStream } = await import('node:fs')
    const stream = createWriteStream(archiveTemp, { flags: 'wx', mode: 0o600 })
    await run('git', [
      'archive', '--format=tar', `--prefix=${manifest.archive.prefix}`, 'FETCH_HEAD', '--', ...manifest.archive.paths,
    ], { cwd: work, stdoutFile: stream })
    await new Promise((resolve, reject) => {
      stream.end(resolve)
      stream.once('error', reject)
    })
    await validateArchive(archiveTemp, manifest)
    await rename(archiveTemp, cachePath).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error
      await rm(archiveTemp, { force: true })
    })
  } finally {
    await rm(archiveTemp, { force: true })
    await rm(work, { recursive: true, force: true })
  }
}

async function materialize(outputDir, archivePath, manifest) {
  const parent = path.dirname(outputDir)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const stage = await mkdtemp(path.join(parent, `.${path.basename(outputDir)}.stage-`))
  try {
    await run('tar', ['-xf', archivePath, '-C', stage])
    await validateExtracted(stage, manifest)
    await rm(outputDir, { recursive: true, force: true })
    await rename(stage, outputDir)
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  }
}

export async function fetchWorkspaceSource(options = {}) {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const cacheDir = options.cacheDir ?? defaultCacheDir()
  await mkdir(cacheDir, { recursive: true, mode: 0o700 })
  await chmod(cacheDir, 0o700)
  const cachePath = path.join(cacheDir, `${manifest.archive.sha256}.tar`)
  let source = 'cache'
  try {
    await validateArchive(cachePath, manifest)
  } catch (error) {
    if (options.offline) throw new Error(`offline workspace source cache miss or corruption at ${cachePath}`, { cause: error })
    await rm(cachePath, { force: true })
    await bootstrap(cachePath, manifest)
    await chmod(cachePath, 0o600)
    source = 'network'
  }
  await validateArchive(cachePath, manifest)
  if (options.outputDir) await materialize(options.outputDir, cachePath, manifest)
  return {
    source,
    cachePath,
    outputDir: options.outputDir ?? null,
    releaseCommit: manifest.releaseCommit,
    archiveSha256: manifest.archive.sha256,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage())
    return
  }
  const result = await fetchWorkspaceSource(options)
  process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `[workspace-source] ${result.source}: ${result.archiveSha256}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[workspace-source] ERROR ${error.message}`)
    process.exitCode = 1
  })
}
