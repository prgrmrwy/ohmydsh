import type { CollectedSession } from './collection.js'
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs'
import { decodeStoredEvidence } from './evidence-log.js'

/** Caller resolves the current artifact from trusted Host metadata; never repairs or migrates. */
export function storedEvidenceReader(locate: (id: string) => Promise<{ path: string; encoding: 'zstd' | 'jsonl' }>): (id: string) => Promise<CollectedSession> {
  return async id => {
    const artifact = await locate(id)
    const fd = openSync(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const before = fstatSync(fd)
      if (!before.isFile() || before.nlink !== 1) throw new Error('Invalid evidence artifact')
      const bytes = readFileSync(fd)
      const after = fstatSync(fd)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error('Evidence changed during collection')
      const decoded = decodeStoredEvidence(bytes, artifact.encoding, id)
      return { id, ...(decoded.header.parentSession ? { parent: decoded.header.parentSession } : {}), inheritedEventCount: decoded.inheritedEventCount, events: decoded.events }
    } finally { closeSync(fd) }
  }
}
