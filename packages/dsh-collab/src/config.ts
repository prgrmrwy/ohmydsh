import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { dirname, basename, isAbsolute, join, relative, sep, resolve } from 'node:path'

export type Admission = 'invite' | 'allowlist'
export interface HostConfig { dataDir?: string; admission?: Admission; allowedSessionIds?: readonly string[]; denySessionIds?: readonly string[]; memberTrust?: boolean }
/** `memberTrust`: the operator pre-consents that invitees join and members take requests within their own permissions. */
export interface AdmissionPolicy { admission: Admission; allowedSessionIds: readonly string[]; denySessionIds: readonly string[]; memberTrust: boolean }
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
const ids = (value: unknown): string[] => {
  const list = value ?? []
  if (!Array.isArray(list) || list.some(id => typeof id !== 'string' || !id.trim() || id !== id.trim()) || new Set(list).size !== list.length) bad()
  return [...list]
}
/** Synchronous admission/ID-list validation; runs before any tool registration or IO. */
export function admissionPolicy(config: HostConfig): AdmissionPolicy {
  if (!config || typeof config !== 'object' || Object.keys(config).some(key => !['dataDir', 'admission', 'allowedSessionIds', 'denySessionIds', 'memberTrust'].includes(key))) bad()
  const admission = config.admission ?? 'invite'
  if (admission !== 'invite' && admission !== 'allowlist') bad()
  const allowedSessionIds = ids(config.allowedSessionIds), denySessionIds = ids(config.denySessionIds)
  if (allowedSessionIds.some(id => denySessionIds.includes(id))) bad()
  const memberTrust = config.memberTrust ?? true
  if (typeof memberTrust !== 'boolean') bad()
  return { admission, allowedSessionIds, denySessionIds, memberTrust }
}
/**
 * Default ledger location: `<DSH home>/plugins/dsh-collab`, where DSH home follows the official
 * rule (non-empty Host-process `DSH_HOME`, else `~/.dsh`). Never derived from session input.
 */
export function defaultDataDir(env: Record<string, string | undefined> = process.env) {
  const fromEnv = env.DSH_HOME
  const home = fromEnv !== undefined && fromEnv.trim().length > 0 ? resolve(fromEnv.startsWith('~/') ? join(homedir(), fromEnv.slice(2)) : fromEnv) : join(homedir(), '.dsh')
  return join(home, 'plugins', 'dsh-collab')
}
export async function validateConfig(config: HostConfig, workspaces: readonly string[], env: Record<string, string | undefined> = process.env) {
  const policy = admissionPolicy(config)
  if (config.dataDir !== undefined && (typeof config.dataDir !== 'string' || !isAbsolute(config.dataDir))) bad()
  const dataDir = await canonical(resolve(config.dataDir ?? defaultDataDir(env)))
  if (dataDir.split(sep).includes('node_modules')) bad()
  for (const cwd of workspaces) {
    if (!isAbsolute(cwd)) bad()
    if (under(await canonical(resolve(cwd)), dataDir)) bad()
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  if (((await stat(dataDir)).mode & 0o077) !== 0) bad()
  return { dataDir, ...policy, serviceId: `dsh-collab:${createHash('sha256').update(dataDir).digest('hex')}` }
}
