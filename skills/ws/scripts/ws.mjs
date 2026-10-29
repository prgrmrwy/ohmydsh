#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const name = 'dsh-worktree-session', bin = 'dsh-ws'
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
function findCli() {
  const key = Object.keys(process.env).find(k => k.toLowerCase() === 'path')
  for (const dir of (process.env[key] || '').split(path.delimiter).filter(Boolean)) {
    if (process.platform === 'win32') {
      const exe = path.join(dir, bin + '.exe')
      if (fs.existsSync(exe) && fs.statSync(exe).isFile()) return [exe, []]
      if (['', '.cmd', '.ps1'].some(ext => fs.existsSync(path.join(dir, bin + ext)))) {
        const cli = packageCli(path.join(dir, 'node_modules', name)) || packageCli(path.join(dir, '..', name))
        if (cli) return cli
        throw new Error('ws: PATH shim layout not supported; use the installed package real JS entrypoint')
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
  const git = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', shell: false, windowsHide: true })
  if (git.status === 0) {
    const root = path.join(git.stdout.trim(), 'packages', 'worktree-session')
    const cli = packageCli(root)
    if (cli) return cli
    if (fs.existsSync(path.join(root, 'package.json'))) throw new Error('ws: generated CLI is missing; run npm run build --workspace dsh-worktree-session after repository bootstrap')
  }
  throw new Error('ws: dsh-worktree-session is not installed')
}
try {
  const [command, prefix] = findCli()
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], { stdio: 'inherit', shell: false, windowsHide: true })
  if (result.error) console.error(`ws: ${result.error.message}`)
  process.exitCode = result.status ?? 1
} catch (error) { console.error(error.message); process.exitCode = 1 }
