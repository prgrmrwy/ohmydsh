import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { KERNEL_VERSION } from '../tools/descriptions.generated.js'

export interface MemexInstallation {
  readonly root: string
  readonly skills: string
  readonly cli: string
  readonly version: string
}

function assertChild(root: string, path: string, label: string): void {
  const rel = relative(root, path)
  if (rel === '' || rel === '..' || rel.startsWith('../')) throw new Error(`${label} escapes the memex package root: ${path}`)
}

let cached: MemexInstallation | undefined

export function resolveMemexInstallation(): MemexInstallation {
  if (cached) return cached
  const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5_000 }).trim()
  const root = realpathSync(join(npmRoot, '@touchskyer', 'memex'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string; bin?: { memex?: string } }
  if (pkg.version !== KERNEL_VERSION) throw new Error(`Expected @touchskyer/memex@${KERNEL_VERSION}, found ${pkg.version ?? 'unknown'}`)
  const skillsEntry = join(root, 'skills')
  if (lstatSync(skillsEntry).isSymbolicLink()) throw new Error(`memex skills directory must not be a symlink: ${skillsEntry}`)
  const skills = realpathSync(skillsEntry)
  assertChild(root, skills, 'memex skills directory')
  const cliRelative = pkg.bin?.memex
  if (!cliRelative) throw new Error('Installed memex package does not declare its CLI')
  const cli = realpathSync(join(root, cliRelative))
  assertChild(root, cli, 'memex CLI')
  cached = { root, skills, cli, version: pkg.version }
  return cached
}
