/**
 * Caller-bound inquiry ACCEPTANCE.
 *
 * This is the one place a model can put a question into the ledger, and it is
 * deliberately the narrowest possible surface: the model supplies a roster
 * reference, a question and a purpose. EVERYTHING else that decides who may
 * read the answer — the requester identity, the fixed circle parent, the origin
 * of the work and its final audience — is derived by the Host from the ACTUAL
 * executing session. There is no parameter for any of them, and an argument
 * object that carries one anyway is refused rather than ignored, so a model
 * cannot discover which spellings happen to be dropped.
 *
 * The roster reference is NOT authorization (spec: "名单引用在询问接受和实际派发时
 * 重新授权"). It is re-resolved here against CURRENT membership: the candidate
 * set is rebuilt from the caller resolver at call time, so an out-of-scope,
 * retired, archived or stale-generation reference simply has no match. All of
 * those collapse into one uniform refusal, which is what keeps the failure from
 * leaking whether a foreign session exists.
 *
 * Acceptance means ACCEPTED, not answered. The durable write happens before
 * this function resolves; dispatch, the answer and the result continuation are
 * owned by other slices and are explicitly not performed here.
 */
import {
  readForCollaborationCaller, type CollaborationCaller, type CollaborationCallerPorts,
} from '../collaboration/caller.js'
import {
  inquiryMemberKey, InquiryLedgerError, INQUIRY_LIMITS,
  type InquiryAudience, type InquiryOrigin, type InquiryRecord, type InquiryScope,
} from './ledger.js'

/**
 * The provable provenance of the work the caller is currently serving.
 *
 * The Host resolves this from the executing segment, never from an argument: a
 * requester serving a Feishu delivery cannot relabel its work as private local
 * work in order to widen what an answer may contain. Returning `undefined` —
 * or throwing — means the origin could not be proven, and the inquiry is
 * refused rather than defaulted to `local`.
 */
export interface InquiryOriginProof {
  readonly origin: InquiryOrigin
  readonly audience: InquiryAudience
}

/** What this module needs; nothing here can send, reply or publish anything. */
export interface InquiryAskDependencies {
  readonly ports: CollaborationCallerPorts
  /** Durable ledger. It counts budgets and commits atomically; see ledger-store. */
  readonly store: { accept(request: unknown, facts: unknown): Promise<InquiryRecord> }
  /** Host-derived origin/audience for the ACTUAL executing session. */
  readonly origin: (callerSessionId: string) => InquiryOriginProof | undefined
  /** Host clock. A model or client timestamp is never accepted as provenance. */
  readonly now: () => number
  /** Host-owned id. The model cannot choose or predict an inquiry id. */
  readonly newInquiryId: () => string
}

/** Exactly the three things a model may say. Anything else is a refusal. */
const ASK_KEYS = Object.freeze(['target', 'question', 'purpose'])

/**
 * Compose the opaque target reference for one roster entry.
 *
 * The roster publishes a member's durable position (sessionId, and for a child
 * its locusId and generation); this is the single canonical way those fields
 * become the `target` string. It is a NAME, not a capability: holding one lets
 * a caller point at a member, and acceptance still re-resolves it against
 * current membership. Because the generation is inside the reference, a stale
 * one can never be silently redirected onto a rebuilt successor.
 */
export function inquiryTargetReference(member: unknown): string {
  return inquiryMemberKey(member)
}

/** One uniform denial for every unprovable caller, target or malformed request. */
export class InquiryRefusedError extends Error {
  readonly code = 'INQUIRY_REFUSED'
  constructor() {
    // Never say WHY: "no such member", "retired" and "another circle" must be
    // indistinguishable, or the refusal becomes a membership oracle.
    super('This inquiry cannot be accepted. Refresh your collaborator list and check the question and purpose.')
    this.name = 'InquiryRefusedError'
  }
}

/**
 * A budget refusal, which is deliberately NOT the uniform denial.
 *
 * Scope denial and budget exhaustion call for different behaviour: the first
 * means stop, the second means this chain has spent its allowance. Conflating
 * them would push a model into retrying a denied target forever.
 */
export type InquiryLimitCode =
  | 'CHAIN_DEPTH_EXCEEDED'
  | 'TARGET_ALREADY_VISITED'
  | 'ROOT_BUDGET_EXCEEDED'
  | 'PENDING_BUDGET_EXCEEDED'

const LIMIT_CODES: readonly string[] = Object.freeze([
  'CHAIN_DEPTH_EXCEEDED', 'TARGET_ALREADY_VISITED',
  'ROOT_BUDGET_EXCEEDED', 'PENDING_BUDGET_EXCEEDED',
])

export class InquiryLimitError extends Error {
  constructor(readonly code: InquiryLimitCode) {
    super({
      CHAIN_DEPTH_EXCEEDED: 'This inquiry chain has reached its depth budget.',
      TARGET_ALREADY_VISITED: 'This member is already on the current inquiry chain.',
      ROOT_BUDGET_EXCEEDED: 'This inquiry chain has spent its inquiry budget.',
      PENDING_BUDGET_EXCEEDED: 'That member already has as many pending inquiries as it can hold.',
    }[code])
    this.name = 'InquiryLimitError'
  }
}

/**
 * What the requester is told. It says ACCEPTED and nothing stronger.
 *
 * `answered: false` is a literal field rather than an inference from the
 * absence of an answer, so a model cannot read a successful acceptance as a
 * reply. No chat, delivery or message identifier appears here.
 */
export interface InquiryAcceptance {
  readonly status: 'accepted'
  readonly answered: false
  readonly inquiryId: string
  /** Echo of the accepted roster reference, so the caller can correlate. */
  readonly target: string
  readonly acceptedAt: number
  readonly note: string
}

const ACCEPTED_NOTE =
  'Accepted and queued only. This is not an answer: end your current turn, and the result arrives later as a separate correlated continuation.'

function refuse(): never { throw new InquiryRefusedError() }

/**
 * Read exactly the declared keys as DATA properties off an untrusted object.
 *
 * Extra keys are a refusal, not a silent drop: a request carrying `audience`,
 * `origin`, `requester` or a delivery id is an attempt to widen disclosure, and
 * ignoring it would teach a model that the field is merely unsupported.
 */
function fields(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) refuse()
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) refuse()
  const actual = Reflect.ownKeys(input)
  if (actual.length !== keys.length || actual.some(key => typeof key !== 'string' || !keys.includes(key))) refuse()
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(input, key)
    // Never invoke a getter on a model-controlled object.
    if (!property || !('value' in property)) refuse()
    result[key] = property.value
  }
  return result
}

/**
 * Bounded non-empty text, checked BEFORE the store is touched.
 *
 * The pure model enforces the same ceilings, but letting an oversized question
 * reach the durable layer first would mean a rejected request still consumed a
 * transaction. The bounds are read from the ledger's limits so the two cannot
 * drift apart.
 */
function bounded(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) refuse()
  return value
}

/**
 * Rebuild the set of members this caller may address, right now.
 *
 * Derived from the resolver's current facts, so a reference the model kept from
 * an earlier roster is only usable while it still names a current member at the
 * same generation. The caller itself is never a candidate, which is how a
 * self-target becomes the same uniform refusal as a foreign one.
 */
function addressable(caller: CollaborationCaller): ReadonlyMap<string, InquiryScope> {
  const candidates = new Map<string, InquiryScope>()
  if (caller.callerLocus !== undefined) {
    const parent: InquiryScope = { kind: 'main', sessionId: caller.parentSessionId }
    candidates.set(inquiryMemberKey(parent), parent)
  }
  for (const child of caller.children) {
    if (child.sessionId === caller.callerSessionId) continue
    if (caller.callerLocus !== undefined && child.locusId === caller.callerLocus.locusId) continue
    const scope: InquiryScope = {
      kind: 'child', sessionId: child.sessionId, locusId: child.locusId, generation: child.generation,
    }
    candidates.set(inquiryMemberKey(scope), scope)
  }
  return candidates
}

/** The caller's own durable circle position, as the ledger records a requester. */
function selfScope(caller: CollaborationCaller): InquiryScope {
  return caller.callerLocus === undefined
    ? { kind: 'main', sessionId: caller.parentSessionId }
    : {
        kind: 'child', sessionId: caller.callerSessionId,
        locusId: caller.callerLocus.locusId, generation: caller.callerLocus.generation,
      }
}

/** Proven origin, or a refusal. There is no path from "unknown" to `local`. */
function provenOrigin(callerSessionId: string, deps: InquiryAskDependencies): InquiryOriginProof {
  let proof: InquiryOriginProof | undefined
  try {
    proof = deps.origin(callerSessionId)
  } catch {
    // An unreadable origin proves nothing; guessing here is exactly the hole.
    refuse()
  }
  if (proof === null || typeof proof !== 'object') refuse()
  const { origin, audience } = proof
  if (origin === null || typeof origin !== 'object' || audience === null || typeof audience !== 'object') refuse()
  return { origin, audience }
}

/**
 * Accept one inquiry from the actual executing session.
 *
 * Authorization and the target resolution happen at the SAME fence as the
 * caller read, matching how `query.ts`/`write.ts` use the resolver: the
 * candidate set cannot be observed before a revocation and used after it. The
 * durable write then runs outside that fence, because the store performs its
 * own atomic recheck and counts the budgets from durable rows itself.
 *
 * Resolves only after the record is persisted. Every failure other than a
 * budget is the one uniform refusal.
 */
export async function acceptInquiryFromCaller(
  execution: unknown,
  args: unknown,
  deps: InquiryAskDependencies,
): Promise<InquiryAcceptance> {
  let commit: (() => Promise<InquiryRecord>) | undefined
  let reference = ''
  try {
    const asked = fields(args, ASK_KEYS)
    const target = bounded(asked.target, INQUIRY_LIMITS.identifierLength * 4)
    const question = bounded(asked.question, INQUIRY_LIMITS.questionLength)
    const purpose = bounded(asked.purpose, INQUIRY_LIMITS.purposeLength)
    const sessionId = (execution as { agent?: { id?: unknown } } | undefined)?.agent?.id
    if (typeof sessionId !== 'string') refuse()

    commit = await readForCollaborationCaller(sessionId, deps.ports, caller => {
      const resolved = addressable(caller).get(target)
      // Out-of-scope, retired, archived, wrong generation and self all land here.
      if (resolved === undefined) refuse()
      const { origin, audience } = provenOrigin(caller.callerSessionId, deps)
      const request = {
        target: resolved, question, purpose,
        // The model is never given a say in the origin, so it declares nothing.
        declaredOrigin: null,
      }
      const facts = {
        inquiryId: deps.newInquiryId(),
        requester: selfScope(caller),
        circleParentSessionId: caller.parentSessionId,
        origin, audience,
        createdAt: deps.now(),
      }
      reference = target
      return () => deps.store.accept(request, facts)
    })
  } catch {
    throw new InquiryRefusedError()
  }

  let record: InquiryRecord
  try {
    record = await commit()
  } catch (error) {
    // A spent budget is actionable and must not read as a scope denial.
    if (error instanceof InquiryLedgerError && LIMIT_CODES.includes(error.code)) {
      throw new InquiryLimitError(error.code as InquiryLimitCode)
    }
    // A storage fault must never surface as an acceptance.
    throw new InquiryRefusedError()
  }

  return Object.freeze({
    status: 'accepted' as const,
    answered: false as const,
    inquiryId: record.id,
    target: reference,
    acceptedAt: record.createdAt,
    note: ACCEPTED_NOTE,
  })
}
