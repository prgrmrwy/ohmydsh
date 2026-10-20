import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Probe = (pid: number) => unknown
export type LockVerdict = { remove: true; instanceId: string; pid: number } | { remove: false; instanceId?: string; pid?: number; reason: string }

/**
 * Death proof for a residual lock: parseable, positive safe-integer pid, the
 * local liveness probe reports ESRCH, and the bytes are unchanged on re-read.
 * Valid only when one Host process ever uses this dataDir (no shared pid namespaces).
 */
export async function judgeLock(dataDir: string, spaceId: string, probe: Probe = pid => process.kill(pid, 0)): Promise<LockVerdict> {
  const path = join(dataDir, `${spaceId}.lock`)
  const bytes = await readFile(path, 'utf8')
  let lock: { instanceId?: unknown; pid?: unknown }
  try { lock = JSON.parse(bytes) } catch { return { remove: false, reason: 'unparseable' } }
  const instanceId = typeof lock?.instanceId === 'string' && lock.instanceId ? lock.instanceId : undefined
  const pid = typeof lock?.pid === 'number' && Number.isSafeInteger(lock.pid) && lock.pid > 0 ? lock.pid : undefined
  if (!instanceId || !pid) return { remove: false, ...(instanceId ? { instanceId } : {}), reason: 'unparseable' }
  let code: string | undefined
  try { probe(pid) } catch (error) { code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }
  if (code !== 'ESRCH') return { remove: false, instanceId, pid, reason: code ? `probe-${code}` : 'alive' }
  if (await readFile(path, 'utf8') !== bytes) return { remove: false, instanceId, pid, reason: 'changed' }
  return { remove: true, instanceId, pid }
}
