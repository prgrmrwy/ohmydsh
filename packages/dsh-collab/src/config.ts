import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, basename, isAbsolute, join, relative, sep, resolve } from 'node:path'

export interface HostConfig { dataDir: string; allowedSessionIds?: readonly string[] }
function bad(): never { throw Object.assign(new Error('Invalid collaboration Host configuration'), { code: 'COLLAB_BAD_CONFIG' }) }
function under(root: string, target: string) {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return join(await canonical(parent), basename(path))
  }
}
export function checkCurrentLocation(dataDir: string, workspaces: readonly string[]) {
  const current = realpathSync(dataDir)
  if (current.split(sep).includes('node_modules')) bad()
  for (const cwd of workspaces) {
    if (!isAbsolute(cwd) || under(realpathSync(cwd), current)) bad()
  }
}
export async function validateConfig(config: HostConfig, workspaces: readonly string[]) {
  if (!config || Object.keys(config).some(key => !['dataDir', 'allowedSessionIds'].includes(key)) || typeof config.dataDir !== 'string' || !isAbsolute(config.dataDir)) bad()
  const allowed = config.allowedSessionIds ?? []
  if (!Array.isArray(allowed) || allowed.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim()) || new Set(allowed).size !== allowed.length) bad()
  const dataDir = await canonical(resolve(config.dataDir))
  if (dataDir.split(sep).includes('node_modules')) bad()
  for (const cwd of workspaces) {
    if (!isAbsolute(cwd)) bad()
    if (under(await canonical(resolve(cwd)), dataDir)) bad()
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  if (((await stat(dataDir)).mode & 0o077) !== 0) bad()
  return { dataDir, allowedSessionIds: [...allowed], serviceId: `dsh-collab:${createHash('sha256').update(dataDir).digest('hex')}` }
}
