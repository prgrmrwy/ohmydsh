/**
 * OPTIONAL owner view/correction surface for public facts.
 *
 * This is NOT the primary write path: public facts are updated autonomously by
 * in-scope agents through the caller-bound tool surface, whose authorization is
 * scope membership derived by the Host caller resolver. This HTTP slice exists
 * so an operator can inspect the current revision plus its history and correct
 * a bad revision from the browser; it therefore keeps the real Connection fence
 * and an explicit Host owner-identity requirement, which is a stricter gate than
 * agent writes rather than the rule that governs them. Mounting is separate, and
 * nothing here ensures a record, provisions a parent or grants scope membership.
 */
import { PetError } from '../errors.js'
import {
  petRoute, strictBody, withBrowserAuth,
  type BrowserAuthFence, type RouteRegistration,
} from '../http.js'
import {
  COLLABORATION_CONTEXT_LIMITS, COLLABORATION_CONTEXT_SHARING_SCOPE,
  CollaborationContextError, updateCollaborationContext,
  type AuthoredCollaborationContext, type CollaborationContextRecord,
} from './context.js'
import { CollaborationContextStoreError } from './context-store.js'

/** Structural port: deliberately no ensure, session creation or group mutation. */
export interface CollaborationContextRouteStore {
  get(parentSessionId: string): CollaborationContextRecord | undefined
  audit(parentSessionId: string): readonly CollaborationContextRecord[]
  update(parentSessionId: string, replacement: unknown, verifiedAuthor: unknown): Promise<AuthoredCollaborationContext>
}

export interface CollaborationContextRouteDeps {
  readonly store: CollaborationContextRouteStore
  /** Actual Host Connection service. Missing/broken API must deny, not bypass. */
  readonly browserAuth?: BrowserAuthFence
  /**
   * Host authorization for this selected parent, sampled only AFTER Connection
   * authenticates the browser. This discriminant is a trusted fact, not a body
   * claim. The production locusIdentity actor label alone is NOT this proof.
   * Host may authorize retained records after parent invalidation for
   * inspection; this is deliberately not the agent caller/membership resolver,
   * because this surface is an operator correction path, not the agent one.
   */
  readonly ownerIdentity?: (parentSessionId: string) => {
    readonly kind: 'local-owner'
    readonly actorId: string
  } | undefined
  /** Inject Host Date.now; never accept a client-supplied authoring timestamp. */
  readonly now: () => number
}

const path = '/api/pet/collaboration/context'
const bodyKeys = [
  'parentSessionId', 'expectedRevision', 'workDescription', 'resourceReferences',
  'commonConstraints', 'sources', 'sharingScope',
] as const

function invalid(): never {
  throw new PetError('INVALID_REQUEST', 'Invalid public context request.')
}
function identifier(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input
    || input.length > COLLABORATION_CONTEXT_LIMITS.identifierLength) invalid()
  return input
}
function denied(): never {
  throw new PetError('LOCUS_PERMISSION_DENIED', 'Verified Host owner authorization is required.')
}

/** Never propagate storage paths, arbitrary exception messages, or body content. */
function safeContextError(error: unknown): PetError {
  if (error instanceof CollaborationContextError) {
    switch (error.code) {
      case 'INVALID_CONTEXT_INPUT': return new PetError('INVALID_REQUEST', 'Invalid public context input.')
      case 'REVISION_CONFLICT': return new PetError('REVISION_CONFLICT', 'Public context revision changed; reread and retry.')
      case 'REVISION_OVERFLOW': return new PetError('REVISION_CONFLICT', 'Public context revision cannot be incremented safely.')
      case 'PARENT_MISMATCH': return new PetError('LOCUS_PERMISSION_DENIED', 'Public context authorization does not match.')
    }
  }
  if (error instanceof CollaborationContextStoreError) {
    if (error.code === 'CONTEXT_NOT_FOUND') {
      return new PetError('SOURCE_NOT_FOUND', 'Public context is not established.')
    }
    return new PetError('LOCUS_UNAVAILABLE', 'Public context storage is unavailable or could not be verified.')
  }
  return new PetError('INTERNAL', 'Public context operation failed.')
}

/**
 * Return one exact WebServer registration supporting GET (current + revision
 * history) and POST (full replacement/CAS correction) on the same path. Already
 * wrapped in both real Connection and petRoute fences: mount with kind: exact.
 * No group allowlist, agent tool, parent provisioning, history extraction,
 * resource download, local-field fallback or model wakeup is available here.
 */
export function createCollaborationContextRoutes(deps: CollaborationContextRouteDeps): RouteRegistration[] {
  const fence: BrowserAuthFence = {
    requestRejection(req) {
      try {
        if (typeof deps.browserAuth?.requestRejection !== 'function') return 401
        const verdict = deps.browserAuth.requestRejection(req)
        return verdict === undefined || verdict === 401 || verdict === 403 ? verdict : 401
      } catch { return 401 }
    },
  }
  const ownerActor = (parentSessionId: string): string => {
    try {
      const identity = deps.ownerIdentity?.(parentSessionId)
      if (identity?.kind !== 'local-owner') return denied()
      return identifier(identity.actorId)
    } catch { return denied() }
  }

  return [withBrowserAuth(petRoute(path, async ({ body, req }) => {
    let url: URL
    try { url = new URL(req.url ?? '', 'http://localhost') } catch { return invalid() }
    if (url.pathname !== path || url.hash !== '') invalid()
    if (req.method !== 'GET' && req.method !== 'POST') invalid()

    let parentSessionId: string
    let input: Record<string, unknown> | undefined
    if (req.method === 'GET') {
      if (url.searchParams.size !== 1 || !url.searchParams.has('parentSessionId')) invalid()
      parentSessionId = identifier(url.searchParams.get('parentSessionId'))
    } else {
      if (url.search !== '') invalid()
      // Collapse allowlist errors as well: never reflect attacker-chosen keys.
      try { input = strictBody(body, bodyKeys) } catch { return invalid() }
      if (bodyKeys.some(key => !Object.hasOwn(input!, key))) invalid()
      parentSessionId = identifier(input['parentSessionId'])
      if (input['sharingScope'] !== COLLABORATION_CONTEXT_SHARING_SCOPE) invalid()
    }
    const authoredBy = ownerActor(parentSessionId)

    // These reads are synchronous detached snapshots from the sole Host writer;
    // no await separates current from history. Never ensure a missing record.
    let current: CollaborationContextRecord | undefined
    try {
      current = deps.store.get(parentSessionId)
      if (current === undefined) throw new CollaborationContextStoreError('CONTEXT_NOT_FOUND')
      if (req.method === 'GET') return { current, audit: deps.store.audit(parentSessionId) }
    } catch (error) { throw safeContextError(error) }

    let authoredAt: number
    try {
      authoredAt = deps.now()
      if (!Number.isSafeInteger(authoredAt) || authoredAt < 0) throw new Error()
    } catch {
      throw new PetError('LOCUS_UNAVAILABLE', 'Host authoring clock is unavailable.')
    }
    const replacement = {
      expectedRevision: input!['expectedRevision'], workDescription: input!['workDescription'],
      resourceReferences: input!['resourceReferences'], commonConstraints: input!['commonConstraints'],
      sources: input!['sources'],
    }
    // An operator correction is attributed to the main session's own writer
    // slot: it is not a Locus child, and the browser actor is recorded as the
    // author identity so the revision history shows where the change came from.
    const verifiedAuthor = {
      parentSessionId, authoredBy, authoredAt,
      authorLocus: { kind: 'parent' as const }, sharingScope: COLLABORATION_CONTEXT_SHARING_SCOPE,
    }
    try {
      // Reuse the strict pure model's fields/limits; validation is not a commit.
      // The store must recheck CAS atomically when committing current + history.
      updateCollaborationContext(current, replacement, verifiedAuthor)
      return await deps.store.update(parentSessionId, replacement, verifiedAuthor)
    } catch (error) { throw safeContextError(error) }
  }), fence)]
}
