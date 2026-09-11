#!/usr/bin/env node
/** Build fixed-source atomic storage packages for the Pet locus domain. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const checkout = join(here, '.storage-upstream')
const artifacts = join(here, 'storage-artifacts')
const patchFile = join(here, 'storage-atomic.patch')
const tag = 'dsh-v0.1.2-rc.1'
const patchSha256 = '18ec93c5240612b513871d65db2d100ee6165ea1ba251dbf91e670963dd35bed'
const packages = [
  ['storage/storage', 'storage'],
  ['storage/storage-domain', 'storage-domain'],
  ['storage/storage-sqlite', 'storage-sqlite'],
  ['storage/storage-json', 'storage-json'],
]

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' })
}
function fail(message) {
  console.error(`[compat/storage] ${message}`)
  process.exit(1)
}
function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
function walkPackageJson(root, result = new Map()) {
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(root, name)
    if (!statSync(path).isDirectory()) continue
    const manifest = join(path, 'package.json')
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
        result.set(pkg.name, pkg.version)
      }
    }
    walkPackageJson(path, result)
  }
  return result
}
function publish(sourceRel, targetName, versions, head) {
  const source = join(checkout, 'packages', sourceRel)
  const target = join(artifacts, targetName)
  rmSync(target, { recursive: true, force: true })
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

if (hashFile(patchFile) !== patchSha256) fail('storage patch hash mismatch')
const fingerprint = createHash('sha256')
  .update(tag)
  .update(readFileSync(patchFile))
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex')
const stamp = join(artifacts, '.fingerprint')
if (
  existsSync(stamp)
  && readFileSync(stamp, 'utf8').trim() === fingerprint
  && packages.every(([, name]) => existsSync(join(artifacts, name, 'lib', 'index.js')))
) {
  console.log('[compat/storage] up-to-date')
  process.exit(0)
}

if (!existsSync(join(checkout, '.git'))) {
  rmSync(checkout, { recursive: true, force: true })
  run('git', ['clone', '--depth', '1', '--branch', tag, 'https://github.com/deepseek-ai/deepseek-harness.git', checkout], here)
} else {
  run('git', ['checkout', '--', '.'], checkout)
}
run('git', ['apply', '--check', patchFile], checkout)
run('git', ['apply', patchFile], checkout)
run('corepack', ['pnpm', 'install', '--prefer-offline'], checkout)
run('corepack', ['pnpm', 'run', 'build:lib:host'], checkout)

const versions = walkPackageJson(join(checkout, 'packages'))
walkPackageJson(join(checkout, 'vendor'), versions)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
mkdirSync(artifacts, { recursive: true })
for (const [source, target] of packages) publish(source, target, versions, head)
writeFileSync(stamp, `${fingerprint}\n`)
console.log('[compat/storage] ready')
