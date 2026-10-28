import type { Context } from '@deepseek-ai/cordis'
import type { EvalLedger } from './ledger.js'
import type { EvidenceBackend } from './artifact-location.js'
import type { CollectedSession } from './collection.js'
import { resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { locateRegisteredArtifact } from './artifact-location.js'
import { storedEvidenceReader } from './storage-reader.js'

/** Backend config is a trusted Host input, never an eval RPC payload. */
export function createHostEvidenceReader(ctx: Context, ledger: EvalLedger, backend: EvidenceBackend): (id: string) => Promise<CollectedSession> {
  const read = storedEvidenceReader(async id => {
    if (!ledger.read().some(entry => entry.kind !== 'job' && entry.id === id)) throw new Error('Refusing unregistered evidence identity')
    const persistence = ctx.get('sessionPersistence')
    if (!persistence || persistence.name !== backend.name) throw new Error('Actual evidence backend mismatch')
    const config = 'config' in persistence ? persistence.config : undefined
    if (!config || typeof config !== 'object' || !('root' in config) || typeof config.root !== 'string' || resolve(config.root) !== backend.root
      || ('compression' in config ? config.compression ?? 'zstd' : 'zstd') !== backend.compression) throw new Error('Actual evidence backend configuration mismatch')
    const sessions = ctx.get('sessions')
    const live = sessions?.get(SessionId(id))
    if (live && !await sessions!.flush(live)) throw new Error('Registered evidence has no durable checkpoint listener')
    const snapshot = await persistence.stat(SessionId(id))
    if (!snapshot || snapshot.header.id !== id || !snapshot.header.cwd) throw new Error('Registered persisted metadata unavailable')
    return locateRegisteredArtifact(backend, { id, cwd: snapshot.header.cwd })
  })
  return read
}
