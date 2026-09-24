/**
 * Single-writer Domain storage for public facts.
 *
 * This layer performs the atomic CAS and retains the revision history; it does
 * NOT authorize writers. Scope membership is caller-derived and enforced by the
 * Host caller resolver before any call here, and first-attachment publication
 * belongs to Host adapters: an ensured record alone never grants a
 * failed/provisioning child access.
 */
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { petDomainSpec } from '../spec.js'
import {
  createEmptyCollaborationContext, parseCollaborationContext, updateCollaborationContext,
  CollaborationContextError, type AuthoredCollaborationContext, type CollaborationContextRecord,
} from './context.js'

type Table = 'collaboration_contexts' | 'collaboration_context_revisions'
type ContextDomain = Domain<typeof petDomainSpec> & {
  readonly supportsTransaction?: boolean
  transaction?: (body: (tx: { put(table: Table, key: string, value: unknown): void }) => void) => Promise<void>
}

export class CollaborationContextStoreError extends Error {
  constructor(readonly code: 'TRANSACTION_UNAVAILABLE' | 'CONTEXT_NOT_FOUND' | 'CONTEXT_CORRUPT') {
    super({ TRANSACTION_UNAVAILABLE: 'Atomic public context storage is unavailable.', CONTEXT_NOT_FOUND: 'Public context is not established.', CONTEXT_CORRUPT: 'Public context storage could not be verified.' }[code])
    this.name = 'CollaborationContextStoreError'
  }
}
function corrupt(): never { throw new CollaborationContextStoreError('CONTEXT_CORRUPT') }
export function contextRevisionKey(parentSessionId: string, revision: number): string {
  return JSON.stringify([parentSessionId, revision])
}

export class CollaborationContextStore {
  constructor(private readonly domain: ContextDomain) {}

  private transaction(body: Parameters<NonNullable<ContextDomain['transaction']>>[0]): Promise<void> {
    if (this.domain.supportsTransaction !== true || typeof this.domain.transaction !== 'function') {
      return Promise.reject(new CollaborationContextStoreError('TRANSACTION_UNAVAILABLE'))
    }
    return this.domain.transaction(body)
  }

  /** Synchronous detached current revision only. Never creates, downloads or falls back. */
  get(parentSessionId: string): CollaborationContextRecord | undefined {
    createEmptyCollaborationContext({ parentSessionId }) // Validate key without normalizing.
    const raw = this.domain.table('collaboration_contexts').get(parentSessionId)
    if (raw === undefined) return undefined
    const record = parseCollaborationContext(raw)
    if (record.parentSessionId !== parentSessionId) corrupt()
    const audit = this.domain.table('collaboration_context_revisions').get(contextRevisionKey(parentSessionId, record.revision))
    if (audit === undefined || JSON.stringify(parseCollaborationContext(audit)) !== JSON.stringify(record)) corrupt()
    return record
  }

  has(parentSessionId: string): boolean { return this.get(parentSessionId) !== undefined }

  /** Full revision history for correction/audit; agents read current only. */
  audit(parentSessionId: string): readonly CollaborationContextRecord[] {
    createEmptyCollaborationContext({ parentSessionId })
    const records: CollaborationContextRecord[] = []
    for (const [key, raw] of this.domain.table('collaboration_context_revisions').entries()) {
      const record = parseCollaborationContext(raw)
      if (record.parentSessionId !== parentSessionId) continue
      if (key !== contextRevisionKey(parentSessionId, record.revision)) corrupt()
      records.push(record)
    }
    return Object.freeze(records.sort((a, b) => a.revision - b.revision))
  }

  /** Idempotent per parent across repository instances through the Domain queue. */
  async ensure(parentSessionId: string): Promise<CollaborationContextRecord> {
    const empty = createEmptyCollaborationContext({ parentSessionId })
    let result: CollaborationContextRecord | undefined
    await this.transaction(tx => {
      result = this.get(parentSessionId)
      if (result !== undefined) return
      // Lost current row must not reset a retained revision/audit to zero.
      if (this.audit(parentSessionId).length !== 0) corrupt()
      result = empty
      tx.put('collaboration_contexts', parentSessionId, empty)
      tx.put('collaboration_context_revisions', contextRevisionKey(parentSessionId, 0), empty)
    })
    return result!
  }

  /**
   * Host MUST prove the writer's current scope membership before this call.
   * Validation and detachment happen before yielding; the Domain callback
   * rechecks the actual CAS, so two in-scope writers racing on one snapshot
   * produce exactly one winner and one REVISION_CONFLICT. Current+history
   * become visible together only after a successful atomic batch.
   */
  async update(parentSessionId: string, replacement: unknown, verifiedAuthor: unknown): Promise<AuthoredCollaborationContext> {
    const before = this.get(parentSessionId)
    if (before === undefined) throw new CollaborationContextStoreError('CONTEXT_NOT_FOUND')
    const candidate = updateCollaborationContext(before, replacement, verifiedAuthor)
    await this.transaction(tx => {
      const current = this.get(parentSessionId)
      if (current === undefined) throw new CollaborationContextStoreError('CONTEXT_NOT_FOUND')
      if (current.revision !== before.revision) throw new CollaborationContextError('REVISION_CONFLICT')
      if (JSON.stringify(current) !== JSON.stringify(before)) corrupt()
      const key = contextRevisionKey(parentSessionId, candidate.revision)
      if (this.domain.table('collaboration_context_revisions').get(key) !== undefined) corrupt()
      tx.put('collaboration_contexts', parentSessionId, candidate)
      tx.put('collaboration_context_revisions', key, candidate)
    })
    return candidate
  }
}
