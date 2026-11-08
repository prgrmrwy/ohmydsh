// Post-deploy smoke checks declared by a deployed package.
//
// A package may ship a CLI that runs OUTSIDE the Host (e.g. dsh-pet's offline
// state migrator). Compiling, installing and loading the plugin in the Host all
// succeed even when that CLI cannot load its own modules standalone, so the
// failure only surfaces when the owner has already stopped DSH to migrate.
// A package opts in with `"ohmydsh": { "deployChecks": [{ "bin": "<name>",
// "args": ["--self-check"] }] }`; sync runs each declared bin from the deployed
// copy with plain `node`, from a neutral cwd, after deployment.
import os from 'node:os'
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from './child-process.mjs'

/**
 * Run every declared deploy check of the given deployed packages.
 * @param {readonly string[]} names npm package names deployed in the profile.
 * @param {{ profileDir: string, run?: typeof spawnSync, cwd?: string }} options
 * @returns {{ passed: string[], failed: string[] }} one label per check.
 */
export function runDeployChecks(names, { profileDir, run = spawnSync, cwd = os.tmpdir() }) {
  const passed = []
  const failed = []
  for (const name of names) {
    const dir = path.join(profileDir, 'node_modules', ...name.split('/'))
    const file = path.join(dir, 'package.json')
    if (!existsSync(file)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      failed.push(`${name}: unreadable package.json (${error.message})`)
      continue
    }
    const checks = pkg?.ohmydsh?.deployChecks
    if (checks === undefined) continue
    if (!Array.isArray(checks)) {
      failed.push(`${name}: ohmydsh.deployChecks must be an array`)
      continue
    }
    const bins = typeof pkg.bin === 'string' ? { [pkg.name]: pkg.bin } : (pkg.bin ?? {})
    for (const check of checks) {
      const args = Array.isArray(check?.args) ? check.args.map(String) : []
      const label = `${name}: ${check?.bin} ${args.join(' ')}`.trim()
      const relative = bins[check?.bin]
      if (typeof relative !== 'string') {
        failed.push(`${label}: bin is not declared by the package`)
        continue
      }
      const result = run(process.execPath, [path.join(dir, relative), ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 60_000,
      })
      if (result.status === 0) passed.push(label)
      else {
        const lines = (result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim().split('\n')
        // Node prints the source location before the error; report the error itself.
        const reason = lines.find((line) => /Error|✗|Cannot find/.test(line))?.trim() ?? lines[0]
        failed.push(`${label}: ${reason}`)
      }
    }
  }
  return { passed, failed }
}
