#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const name = 'dsh-memex', bin = 'dsh-memex-recall-report'
function packageCli(root) {
  try {
    const real = fs.realpathSync(root), pkg = JSON.parse(fs.readFileSync(path.join(real, 'package.json'), 'utf8'))
    const entry = pkg.bin?.[bin]
    if (pkg.name !== name || typeof entry !== 'string') return null
    const file = fs.realpathSync(path.resolve(real, entry))
    if (!file.startsWith(real + path.sep) || !fs.statSync(file).isFile() || !/\.(?:mjs|cjs|js)$/i.test(file)) return null
    return [process.execPath, [file]]
  } catch { return null }
}
function pathCli() {
  const key = Object.keys(process.env).find(k => k.toLowerCase() === 'path')
  for (const dir of (process.env[key] || '').split(path.delimiter).filter(Boolean)) {
    if (process.platform === 'win32') {
      const exe = path.join(dir, bin + '.exe')
      if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return [exe, []]
      if (['', '.cmd', '.ps1'].some(ext => fs.existsSync(path.join(dir, bin + ext)))) {
        const cli = packageCli(path.join(dir, 'node_modules', name)) || packageCli(path.join(dir, '..', name))
        if (cli) return cli
        throw new Error(`${bin}: PATH shim layout not supported; deploy dsh-memex with its real JS bin`)
      }
    } else {
      const file = path.join(dir, bin)
      try {
        fs.accessSync(file, fs.constants.X_OK)
        if (!fs.statSync(file).isFile()) continue
        const real = fs.realpathSync(file)
        return /\.(?:mjs|cjs|js)$/i.test(real) ? [process.execPath, [real]] : [file, []]
      } catch { /* Continue PATH lookup. */ }
    }
  }
}
function findCli() {
  const onPath = pathCli()
  if (onPath) return onPath
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const profiles = path.join(home, 'profiles')
  let entries = []
  try { entries = fs.readdirSync(profiles).filter(name => !name.startsWith('.')).sort() } catch { /* No deployed profile. */ }
  for (const profile of entries) {
    const cli = packageCli(path.join(profiles, profile, 'node_modules', name))
    if (cli) return cli
  }
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false, windowsHide: true })
  if (git.status === 0) {
    const cli = packageCli(path.join(git.stdout.trim(), 'packages', name))
    if (cli) return cli
  }
  throw new Error(`${bin}: not found; deploy dsh-memex (dsh build) on this machine first`)
}
function main() {
  const [command, prefix] = findCli(), args = process.argv.slice(2)
  const run = more => {
    const r = spawnSync(command, [...prefix, ...args, ...more], { stdio: 'inherit', shell: false, windowsHide: true })
    if (r.error) console.error(`${bin}: ${r.error.message}`)
    return r.status ?? 1
  }
  if (args.some(a => a === '--lib' || a.startsWith('--lib=') || a === '--help' || a === '-h')) return run([])
  const root = path.join(os.homedir(), '.dsh-memex')
  let entries
  try { entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0) }
  catch { throw new Error(`memex-recall-report: cannot read libraries under ${root}`) }
  let found = 0, skipped = 0, status = 0
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const lib = path.join(root, entry.name)
    try { if (!fs.statSync(path.join(lib, 'cards')).isDirectory()) continue } catch { continue }
    if (entry.name.startsWith('eval-')) { skipped++; continue }
    found++
    console.log(`\n===== ${entry.name} =====`)
    const result = run(['--lib', lib])
    if (result !== 0) status = result
  }
  if (skipped) console.error(`memex-recall-report: skipped ${skipped} eval libraries (selftest test traffic; pass --lib to inspect one)`)
  if (!found) throw new Error(`memex-recall-report: no libraries with a cards/ directory under ${root}`)
  return status
}
try { process.exitCode = main() } catch (error) { console.error(error.message); process.exitCode = 1 }
