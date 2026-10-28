import { isAbsolute } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { SESSION_FORMAT_VERSION, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { validateStoredEvents, materializeCreateHeader } from '@deepseek-ai/dsh-session-persistence'

export function decodeStoredEvidence(bytes: Buffer, encoding: 'zstd' | 'jsonl', id: string): { header: SessionHeader; inheritedEventCount: number; events: SessionEvent[] } {
  const records = decodeRecords(bytes, encoding)
  const header = records.shift() as Record<string, unknown> | undefined
  if (!header || header.type !== 'session' || header.id !== id || header.version !== SESSION_FORMAT_VERSION
    || typeof header.isSeeded !== 'boolean' || !Number.isSafeInteger(header.createdAt)
    || !Number.isSafeInteger(header.delegationDepth) || (header.delegationDepth as number) < 0) throw new Error('Invalid stored session header')
  if (Object.hasOwn(header, 'sandboxMode') || Object.hasOwn(header, 'approvalPolicy')) throw new Error('Stored header contains retired policy fields')
  const allowed = ['type', 'version', 'id', 'createdAt', 'cwd', 'parentSession', 'isSeeded', 'origin', 'delegationDepth', 'agentPreset']
  if (Object.keys(header).some(key => !allowed.includes(key)) || (header.createdAt as number) < 0 || Object.is(header.createdAt, -0) || Object.is(header.delegationDepth, -0)
    || (header.cwd !== undefined && (typeof header.cwd !== 'string' || !isAbsolute(header.cwd)))
    || (header.parentSession !== undefined && typeof header.parentSession !== 'string')
    || (header.origin !== undefined && header.origin !== 'subagent')
    || (header.agentPreset !== undefined && typeof header.agentPreset !== 'string')) throw new Error('Invalid physical session header')
  const { type: _physicalType, ...metadata } = header
  const meta = materializeCreateHeader(metadata as unknown as SessionHeader)
  validateStoredEvents(meta, records as SessionEvent[])
  checkSequences(records)
  let inheritedEventCount = 0, found = false
  for (const record of records as { type?: string; seq: number; data?: { inherited?: boolean } }[]) {
    if (record.type === 'session/end-seed' && record.data?.inherited === true) { inheritedEventCount = record.seq; found = true }
  }
  if (header.isSeeded !== found) throw new Error('Stored inherited cut mismatch')
  return { header: meta, inheritedEventCount, events: records as SessionEvent[] }
}

/** Consume the full concatenated stream; decompression or JSON failure invalidates the entire log. */
export function decodeEvidenceLog(bytes: Buffer, encoding: 'zstd' | 'jsonl'): unknown[] {
  const events = decodeRecords(bytes, encoding)
  checkSequences(events)
  return events
}

function checkSequences(events: unknown[]): void {
  events.forEach((event, seq) => {
    if (!event || typeof event !== 'object' || Array.isArray(event) || (event as { seq?: unknown }).seq !== seq) throw new Error('Evidence event sequence is not contiguous')
  })
}

function decodeRecords(bytes: Buffer, encoding: 'zstd' | 'jsonl'): unknown[] {
  const chunks: Buffer[] = []
  let offset = 0, total = 0
  const limit = 256 * 1024 * 1024
  if (encoding === 'zstd') {
    while (offset < bytes.length) {
      const result = zstdDecompressSync(bytes.subarray(offset), { info: true, maxOutputLength: limit - total }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } }
      const consumed = result.engine.bytesWritten
      if (!Number.isSafeInteger(consumed) || consumed <= 0 || consumed > bytes.length - offset) throw new Error('Invalid zstd frame consumption')
      chunks.push(result.buffer)
      total += result.buffer.length
      offset += consumed
      if (total > limit) throw new Error('Evidence log too large')
    }
  }
  const decoded = encoding === 'zstd' ? Buffer.concat(chunks) : bytes
  const text = new TextDecoder('utf-8', { fatal: true }).decode(decoded)
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map(line => JSON.parse(line) as unknown)
}
