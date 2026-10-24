#!/usr/bin/env node
// Zero-dependency initialization. npm link is deliberately a separate action.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import managers from './lib/package-manager.cjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REQUIRED = ['zx', 'js-yaml', 'yaml', 'semver', 'typescript']

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:([-+]).*)?$/.exec(String(value).trim())
  return match ? { numbers: match.slice(1,4).map(Number), prerelease: match[4] === '-' } : null
}

export function checkToolchain({ nodeVersion, npmVersion, engines, recommended }) {
  const details = `Node ${String(nodeVersion || 'missing')} / npm ${String(npmVersion || 'missing')}; required Node ${engines.node}, npm ${engines.npm}`
  for (const [tool,value] of [['node',nodeVersion],['npm',npmVersion]]) {
    const minimum = /^>=\s*(\d+\.\d+\.\d+)$/.exec(String(engines[tool]))?.[1]
    const actual = versionParts(value)
    const min = versionParts(minimum)
    if (!actual || !min) return { ok:false, message:`${details}. Cannot validate ${tool}; install a supported Node/npm from https://nodejs.org/` }
    let comparison = 0
    for (let i = 0; i < 3; i++) {
      if (actual.numbers[i] !== min.numbers[i]) { comparison = Math.sign(actual.numbers[i]-min.numbers[i]); break }
    }
    if (comparison < 0 || (comparison === 0 && actual.prerelease)) return { ok:false, message:`${details}. ${tool} is below minimum; upgrade via https://nodejs.org/` }
  }
  const message = `${details}.` + (String(nodeVersion).replace(/^v/,'') === recommended ? '' : ` Recommended Node ${recommended} (.nvmrc); actual ${nodeVersion} meets the minimum and may continue.`)
  return { ok:true, message }
}

export function dependenciesHealthy(repo = ROOT) {
  try {
    const lock = JSON.parse(readFileSync(path.join(repo,'package-lock.json'),'utf8'))
    const require = createRequire(path.join(repo,'package.json'))
    return REQUIRED.every(name => {
      const expected = lock.packages?.[`node_modules/${name}`]?.version
      const packageDir = realpathSync(path.join(repo,'node_modules',name))
      const pkg = JSON.parse(readFileSync(path.join(packageDir,'package.json'),'utf8'))
      const entry = realpathSync(require.resolve(name))
      return typeof expected === 'string' && pkg.name === name && pkg.version === expected
        && entry.startsWith(packageDir + path.sep) && statSync(entry).isFile()
    })
  } catch { return false }
}

export function bootstrap({ repo = ROOT, force = false, env = process.env, npmCommand, quiet = false } = {}) {
  const report = (status,message) => {
    if (!quiet) (status === 0 ? console.log : console.error)(message)
    return {status,message}
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(repo,'package.json'),'utf8'))
    const recommended = readFileSync(path.join(repo,'.nvmrc'),'utf8').trim().replace(/^v/,'')
    const npm = npmCommand ?? managers.resolvePackageManager('npm',{env})
    const version = spawnSync(npm.command,[...npm.argsPrefix,'--version'],{cwd:repo,env,encoding:'utf8',shell:false,timeout:20_000})
    const check = checkToolchain({nodeVersion:process.versions.node,npmVersion:version.status === 0 ? version.stdout.trim() : '',engines:pkg.engines,recommended})
    if (!check.ok) return report(1,check.message)
    if (!quiet) console.log(check.message)
    if (force || !dependenciesHealthy(repo)) {
      if (!quiet) console.log('Installing locked root workspace dependencies with npm ci...')
      const installed = spawnSync(npm.command,[...npm.argsPrefix,'ci'],{cwd:repo,env,stdio:quiet ? 'pipe' : 'inherit',shell:false})
      if (installed.status !== 0) return report(installed.status ?? 1,`npm ci failed (${installed.error?.code ?? installed.status ?? installed.signal ?? 'unknown'}); initialization stopped, no global bin was registered.`)
      if (!dependenciesHealthy(repo)) return report(1,'npm ci completed but locked dependency versions or entrypoints are still unhealthy; initialization stopped.')
    } else if (!quiet) console.log('Locked workspace dependencies are healthy; skipping npm ci (use --force to reinstall).')
    return report(0,'OK 初始化完成。Next: npm link, then dsh build && dsh. No global bin was registered automatically.')
  } catch (error) {
    return report(1,`Bootstrap failed: ${error.message}; install Node/npm from https://nodejs.org/ and run node scripts/bootstrap.mjs again.`)
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--force') || args.length > 1) {
    console.error('Usage: node scripts/bootstrap.mjs [--force]')
    process.exitCode = 1
  } else process.exitCode = bootstrap({force:args.includes('--force')}).status
}
