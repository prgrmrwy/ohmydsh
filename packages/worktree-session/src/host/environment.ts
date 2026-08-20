import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { GitClient } from './git.js'
import { createGitClient } from './git.js'
import { WsError } from './errors.js'
import { atomicWrite, pathExists } from './fs.js'

const BEGIN = '# BEGIN worktree-session managed'
const END = '# END worktree-session managed'

export async function ensureWorktreeExclude(gitCommonDir: string): Promise<void> {
  const path = join(gitCommonDir, 'info', 'exclude')
  await mkdir(dirname(path), { recursive: true })
  const current = await pathExists(path) ? await readFile(path, 'utf8') : ''
  const lines = current.split(/\r?\n/)
  const missing = ['/.worktrees/', 'node_modules'].filter(pattern => !lines.includes(pattern))
  if (missing.length === 0) return
  const prefix = current === '' || current.endsWith('\n') ? current : `${current}\n`
  await atomicWrite(path, `${prefix}${missing.join('\n')}\n`)
}

export function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function managedEnvironment(content: string, dshHome: string): string {
  const block = `${BEGIN}\nDSH_HOME=${shellSingleQuote(dshHome)}\n${END}`
  const escapedBegin = BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escapedBegin}[\\s\\S]*?${escapedEnd}`, 'g')
  const without = content.replace(pattern, '').trimEnd()
  return `${without === '' ? '' : `${without}\n\n`}${block}\n`
}

async function ignoredByGit(repoRoot: string, relativePath: string, git: GitClient): Promise<boolean> {
  const result = await git.runner('git', ['check-ignore', '--quiet', '--', relativePath], { cwd: repoRoot })
  return result.code === 0
}

export async function prepareEnvironment(repoRoot: string, worktreePath: string, gitCommonDir: string, operationId: string, git = createGitClient()): Promise<string> {
  const source = join(repoRoot, '.env.local')
  const destination = join(worktreePath, '.env.local')
  if (await pathExists(source)) {
    if (!(await ignoredByGit(repoRoot, '.env.local', git))) throw new WsError('ENVIRONMENT_FAILED', 'Refusing to synchronize .env.local because the source is not Git-ignored')
    await copyFile(source, destination)
  } else if (!(await pathExists(destination))) {
    await writeFile(destination, '', { mode: 0o600 })
  }
  const dshHome = join(gitCommonDir, 'ws', 'dsh-home', operationId)
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  const content = await readFile(destination, 'utf8')
  await atomicWrite(destination, managedEnvironment(content, dshHome), 0o600)
  await chmod(destination, 0o600)
  return dshHome
}
