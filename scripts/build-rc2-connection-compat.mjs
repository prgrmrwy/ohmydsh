#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fetchConnectionSource, MANIFEST_PATH } from './fetch-rc2-connection-source.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PATCH_ROOT = path.dirname(MANIFEST_PATH)

function usage() {
  return `Usage: node scripts/build-rc2-connection-compat.mjs --output-dir <path> [options]\n\n` +
    `Options:\n` +
    `  --cache-dir <path>   Source archive cache root\n` +
    `  --source-dir <path>  Use an already extracted tree (tests only)\n` +
    `  --offline            Require an existing verified source cache\n` +
    `  --json               Print a JSON result\n`
}

function parseArgs(argv) {
  const options = { offline: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--offline') options.offline = true
    else if (arg === '--json') options.json = true
    else if (arg === '--cache-dir' || arg === '--source-dir' || arg === '--output-dir') {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a path`)
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())
      options[key] = path.resolve(value)
    } else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
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

async function validateBlob(file, expected, label) {
  const bytes = await readFile(file)
  if (expected.sha256 && sha256(bytes) !== expected.sha256) throw new Error(`${label} sha256 mismatch`)
  if (expected.gitBlob && gitBlob(bytes) !== expected.gitBlob) throw new Error(`${label} Git blob mismatch`)
  if (expected.size !== undefined && bytes.byteLength !== expected.size) throw new Error(`${label} size mismatch`)
}

async function validateSource(packageRoot, manifest) {
  for (const entry of manifest.blobs) {
    if (!entry.path.startsWith('packages/client/connection/')) continue
    const relative = entry.path.slice('packages/client/connection/'.length)
    await validateBlob(path.join(packageRoot, relative), entry, `connection source ${relative}`)
  }
}

async function replaceDirectory(stage, outputDir) {
  const backup = `${outputDir}.previous-${process.pid}`
  let backedUp = false
  try {
    await rename(outputDir, backup)
    backedUp = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await rename(stage, outputDir)
    if (backedUp) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (backedUp) await rename(backup, outputDir).catch(() => {})
    throw error
  }
}

export async function buildConnectionCompat(options) {
  if (!options.outputDir) throw new Error('--output-dir is required')
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  const patchPath = path.join(PATCH_ROOT, manifest.patch.path)
  await validateBlob(patchPath, { sha256: manifest.patch.sha256 }, 'connection compatibility patch')

  let fetchedRoot
  let sourceRoot = options.sourceDir
  if (!sourceRoot) {
    fetchedRoot = await mkdtemp(path.join(path.dirname(options.outputDir), '.connection-source-'))
    await fetchConnectionSource({
      cacheDir: options.cacheDir,
      outputDir: fetchedRoot,
      offline: options.offline,
    })
    sourceRoot = path.join(fetchedRoot, manifest.archive.prefix)
  }
  const packageRoot = sourceRoot.endsWith('packages/client/connection')
    ? sourceRoot
    : path.join(sourceRoot, 'packages/client/connection')
  await validateSource(packageRoot, manifest)

  await mkdir(path.dirname(options.outputDir), { recursive: true })
  const stage = await mkdtemp(path.join(path.dirname(options.outputDir), `.${path.basename(options.outputDir)}.stage-`))
  try {
    await cp(packageRoot, stage, { recursive: true })
    await run('git', ['apply', '--check', patchPath], stage)
    await run('git', ['apply', '--whitespace=nowarn', patchPath], stage)
    for (const output of manifest.patch.outputs) {
      await validateBlob(path.join(stage, output.path), output, `connection compatibility output ${output.path}`)
    }
    await replaceDirectory(stage, options.outputDir)
  } catch (error) {
    await rm(stage, { recursive: true, force: true })
    throw error
  } finally {
    if (fetchedRoot) await rm(fetchedRoot, { recursive: true, force: true })
  }
  return {
    outputDir: options.outputDir,
    releaseCommit: manifest.releaseCommit,
    patchSha256: manifest.patch.sha256,
    outputs: manifest.patch.outputs,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return void process.stdout.write(usage())
  const result = await buildConnectionCompat(options)
  process.stdout.write(options.json ? `${JSON.stringify(result)}\n` : `[connection-compat] ${result.patchSha256}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[connection-compat] ERROR ${error.message}`)
    process.exitCode = 1
  })
}
