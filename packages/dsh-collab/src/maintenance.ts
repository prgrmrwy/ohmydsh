import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { CollabError, FileStore } from 'collab-kernel'
export interface RecoveryOptions { dataDir: string; spaceId: string; expectedInstanceId: string; stoppedHostsConfirmed: boolean }
/** Trusted offline operation, NOT atomic CAS against concurrent writers. */
export async function recoverLock(options: RecoveryOptions, probe: (pid: number) => unknown = pid => process.kill(pid, 0)) {
  const refuse = (): never => { throw new CollabError('COLLAB_RECOVERY_REFUSED') }
  if (!options.stoppedHostsConfirmed || !isAbsolute(options.dataDir) || !options.expectedInstanceId?.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.spaceId)) refuse()
  const root = await realpath(options.dataDir)
  const path = join(root, `${options.spaceId}.lock`)
  const bytes = await readFile(path, 'utf8')
  let lock: { instanceId?: unknown; pid?: unknown }
  try { lock = JSON.parse(bytes) } catch { return refuse() }
  if (!lock || lock.instanceId !== options.expectedInstanceId || typeof lock.pid !== 'number' || !Number.isSafeInteger(lock.pid) || lock.pid <= 0) refuse()
  let dead = false
  try { probe(lock.pid as number) }
  catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH' }
  if (!dead || await readFile(path, 'utf8') !== bytes) refuse()
  await new FileStore(root).breakLock(options.spaceId, options.expectedInstanceId)
}
