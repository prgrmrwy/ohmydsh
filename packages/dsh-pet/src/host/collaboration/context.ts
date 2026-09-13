/**
 * Pure public-context values, not a store and not an authorization boundary.
 *
 * Public facts are shared working notes inside ONE collaboration scope. They
 * grant no capability: no file access, no outbound send, no credential, no
 * sandbox or execution-root change. So writing them needs neither human
 * confirmation nor a Locus read/write level. Authorization is exclusively
 * caller-derived scope membership, proven by the Host caller resolver BEFORE
 * this module runs; a VerifiedContextAuthor value is provenance, not proof —
 * a fabricated object has the same shape. A store must still atomically
 * compare revisions, retain the revision history, and publish through the sole
 * writer. Computing a candidate here commits no CAS and establishes no access.
 * No history extraction, local-field merge, resource I/O or permission change.
 */

/** Scope a revision is shared within: not workspace-wide or internet-public. */
export const COLLABORATION_CONTEXT_SHARING_SCOPE = 'parent-and-current-and-future-locus-children' as const

/** String limits count JS UTF-16 code units; list bounds also bound total size. */
export const COLLABORATION_CONTEXT_LIMITS = Object.freeze({
  identifierLength: 256,
  workDescriptionLength: 8_192,
  resourceReferences: 64,
  referenceLength: 2_048,
  commonConstraints: 64,
  constraintLength: 2_048,
  sources: 32,
  sourceLength: 1_024,
})
const limits = COLLABORATION_CONTEXT_LIMITS
const scope = COLLABORATION_CONTEXT_SHARING_SCOPE

/**
 * Which member of the scope wrote one revision.
 *
 * Recorded so readers can see that a fact came from a peer agent rather than a
 * human, and so a later revision can correct it. It is descriptive provenance,
 * never a capability or a claim that the writer verified the content.
 */
export type CollaborationContextAuthorLocus =
  | { readonly kind: 'parent' }
  | { readonly kind: 'child'; readonly locusId: string; readonly generation: number }

export interface CollaborationContextFields {
  /** null = explicitly unknown; '' = explicitly empty/cleared. */
  readonly workDescription: string | null
  /** Opaque references only, not downloaded content or resource permissions. */
  readonly resourceReferences: readonly string[] | null
  readonly commonConstraints: readonly string[] | null
}

interface ContextBase extends CollaborationContextFields {
  /** Durable record identity within this Host; no separate project identity. */
  readonly parentSessionId: string
  readonly revision: number
  /** Writer-declared provenance note for this whole replacement, not verified content. */
  readonly sources: readonly string[]
}

export interface UnknownCollaborationContext extends ContextBase {
  readonly revision: 0
  readonly status: 'unknown'
  readonly workDescription: null
  readonly resourceReferences: null
  readonly commonConstraints: null
  readonly authoredBy: null
  readonly authoredAt: null
  readonly authoredByLocus: null
  readonly sharingScope: null
}

export interface AuthoredCollaborationContext extends ContextBase {
  /** The revision was written by a scope member; null fields remain unknown. */
  readonly status: 'authored'
  /** Host-derived writer identity, e.g. the writing session id. */
  readonly authoredBy: string
  /** Host-supplied epoch milliseconds, never sampled by this pure module. */
  readonly authoredAt: number
  readonly authoredByLocus: CollaborationContextAuthorLocus
  readonly sharingScope: typeof scope
}

export type CollaborationContextRecord = UnknownCollaborationContext | AuthoredCollaborationContext

export interface CollaborationContextReplacement extends CollaborationContextFields {
  readonly expectedRevision: number
  readonly sources: readonly string[]
}

/**
 * Trusted author facts supplied by the Host after the caller resolver proved
 * current scope membership. This module cannot re-derive that membership.
 */
export interface VerifiedContextAuthor {
  readonly parentSessionId: string
  readonly authoredBy: string
  readonly authoredAt: number
  readonly authorLocus: CollaborationContextAuthorLocus
  readonly sharingScope: typeof scope
}

export class CollaborationContextError extends Error {
  constructor(readonly code: 'INVALID_CONTEXT_INPUT' | 'REVISION_CONFLICT' | 'REVISION_OVERFLOW' | 'PARENT_MISMATCH') {
    // Safe diagnostics: do not echo shared content or an unrelated parent's ID.
    super({
      INVALID_CONTEXT_INPUT: 'Invalid public context input.',
      REVISION_CONFLICT: 'Public context revision changed; reread and retry.',
      REVISION_OVERFLOW: 'Public context revision cannot be incremented safely.',
      PARENT_MISMATCH: 'Author facts do not match the context parent.',
    }[code])
    this.name = 'CollaborationContextError'
  }
}
function invalid(): never { throw new CollaborationContextError('INVALID_CONTEXT_INPUT') }

/** Require exact runtime data properties, including symbol/non-enumerable keys. */
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) invalid()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) invalid()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    // Don't invoke getters on caller-controlled objects.
    if (!property || !('value' in property)) invalid()
    result[key] = property.value
  }
  return result
}
function text(input: unknown, max: number, nonblank = false): string {
  if (typeof input !== 'string' || input.length > max || (nonblank && input.trim().length === 0)) invalid()
  return input
}
function identifier(input: unknown): string {
  const value = text(input, limits.identifierLength, true)
  if (value.trim() !== value) invalid()
  return value
}
function integer(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) invalid()
  return input
}
function strings(input: unknown, count: number, length: number, nonempty = false): readonly string[] {
  if (!Array.isArray(input) || input.length > count || (nonempty && input.length === 0)) invalid()
  // Plain dense arrays only: reject holes and hidden extra runtime properties.
  if (Reflect.ownKeys(input).length !== input.length + 1) invalid()
  const result: string[] = []
  for (let i = 0; i < input.length; i++) {
    const property = Object.getOwnPropertyDescriptor(input, String(i))
    if (!property || !('value' in property)) invalid()
    result.push(text(property.value, length, true))
  }
  return Object.freeze(result)
}
/** Detached, frozen writer identity; a child must name its exact generation. */
function authorLocus(input: unknown): CollaborationContextAuthorLocus {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) invalid()
  const kind = Object.getOwnPropertyDescriptor(input, 'kind')
  if (!kind || !('value' in kind)) invalid()
  if (kind.value === 'parent') {
    object(input, ['kind'])
    return Object.freeze({ kind: 'parent' as const })
  }
  if (kind.value !== 'child') invalid()
  const value = object(input, ['kind', 'locusId', 'generation'])
  const generation = integer(value.generation)
  if (generation < 1) invalid()
  return Object.freeze({ kind: 'child' as const, locusId: identifier(value.locusId), generation })
}
function fields(input: Record<string, unknown>): CollaborationContextFields {
  return {
    workDescription: input.workDescription === null ? null : text(input.workDescription, limits.workDescriptionLength),
    resourceReferences: input.resourceReferences === null ? null : strings(input.resourceReferences, limits.resourceReferences, limits.referenceLength),
    commonConstraints: input.commonConstraints === null ? null : strings(input.commonConstraints, limits.commonConstraints, limits.constraintLength),
  }
}
const recordKeys = ['parentSessionId', 'revision', 'status', 'workDescription', 'resourceReferences', 'commonConstraints', 'sources', 'authoredBy', 'authoredAt', 'authoredByLocus', 'sharingScope'] as const

/** Validate even current runtime values, not just a TypeScript-declared shape. */
export function parseCollaborationContext(input: unknown): CollaborationContextRecord {
  const value = object(input, recordKeys)
  const parentSessionId = identifier(value.parentSessionId)
  const revision = integer(value.revision)
  const content = fields(value)
  if (value.status === 'unknown') {
    if (revision !== 0 || content.workDescription !== null || content.resourceReferences !== null || content.commonConstraints !== null || value.authoredBy !== null || value.authoredAt !== null || value.authoredByLocus !== null || value.sharingScope !== null) invalid()
    if (strings(value.sources, limits.sources, limits.sourceLength).length !== 0) invalid()
    return createEmptyCollaborationContext({ parentSessionId })
  }
  if (value.status !== 'authored' || revision === 0 || value.sharingScope !== scope) invalid()
  return Object.freeze({
    parentSessionId, revision, status: 'authored', ...content,
    sources: strings(value.sources, limits.sources, limits.sourceLength, true),
    authoredBy: identifier(value.authoredBy), authoredAt: integer(value.authoredAt),
    authoredByLocus: authorLocus(value.authoredByLocus), sharingScope: scope,
  })
}

/** A value constructor, NOT an idempotent store ensure or an access grant. */
export function createEmptyCollaborationContext(input: unknown): UnknownCollaborationContext {
  const value = object(input, ['parentSessionId'])
  return Object.freeze({
    parentSessionId: identifier(value.parentSessionId), revision: 0, status: 'unknown',
    workDescription: null, resourceReferences: null, commonConstraints: null,
    sources: Object.freeze([]), authoredBy: null, authoredAt: null, authoredByLocus: null, sharingScope: null,
  })
}

/**
 * Calculate an immutable full replacement from Host-derived author facts.
 *
 * All three arguments are validated as actual runtime input. Null fields stay
 * unknown; empty fields withdraw prior values, without claiming history
 * erasure. Throws CollaborationContextError; never mutates or freezes
 * caller-owned objects. There is no human-confirmation flag: an in-scope agent
 * updates public facts autonomously once the Host caller resolver has proven
 * its current scope membership. The caller MUST still persist this candidate
 * atomically with its CAS and revision history; two calls against the same
 * snapshot can both calculate candidates, and only the store decides a winner.
 */
export function updateCollaborationContext(
  current: unknown,
  replacement: unknown,
  verifiedAuthor: unknown,
): AuthoredCollaborationContext {
  const previous = parseCollaborationContext(current)
  const next = object(replacement, ['expectedRevision', 'workDescription', 'resourceReferences', 'commonConstraints', 'sources'])
  const expectedRevision = integer(next.expectedRevision)
  const content = fields(next)
  const sources = strings(next.sources, limits.sources, limits.sourceLength, true)
  const writer = object(verifiedAuthor, ['parentSessionId', 'authoredBy', 'authoredAt', 'authorLocus', 'sharingScope'])
  const parentSessionId = identifier(writer.parentSessionId)
  const authoredBy = identifier(writer.authoredBy)
  const authoredAt = integer(writer.authoredAt)
  const authoredByLocus = authorLocus(writer.authorLocus)
  if (writer.sharingScope !== scope) invalid()
  if (parentSessionId !== previous.parentSessionId) throw new CollaborationContextError('PARENT_MISMATCH')
  if (expectedRevision !== previous.revision) throw new CollaborationContextError('REVISION_CONFLICT')
  if (previous.revision === Number.MAX_SAFE_INTEGER) throw new CollaborationContextError('REVISION_OVERFLOW')
  return Object.freeze({
    parentSessionId, revision: previous.revision + 1, status: 'authored', ...content,
    sources, authoredBy, authoredAt, authoredByLocus, sharingScope: scope,
  })
}
