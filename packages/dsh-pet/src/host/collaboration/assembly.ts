/**
 * Production assembly of the scoped collaboration + inquiry surface.
 *
 * The individual slices (caller resolver, public-fact store, roster, ledger,
 * ask/answer, scheduler, capability detector) already exist and are tested in
 * isolation. This module is the ONE place that decides, for a real Host,
 * whether they may be published at all and on WHICH agent scope — nothing else
 * constructs them.
 *
 * Three rules shape everything here.
 *
 * 1. SCOPE IS PART OF THE CONTRACT. `ctx.tools.register()` resolves its target
 *    layer from the CALLING context's scope tag and silently falls back to the
 *    GLOBAL layer when there is none. Registering any of these tools from the
 *    Host plugin context would offer `pet_collaborators` and `pet_inquire` to
 *    every ordinary DSH session in the process — the exact leak `pet_context`
 *    already had once. Every registration therefore happens on the agent's own
 *    scope, which the caller passes in.
 *
 * 2. FAIL CLOSED, ALL OR NOTHING. {@link composeCollaborationSurface} returns
 *    `undefined` when a required seam is missing (no atomic storage, no caller
 *    resolver, no durable stores), and {@link CollaborationAssembly.install}
 *    rolls back every registration it already made if a later one fails. Pet
 *    then keeps working exactly as before, minus this surface.
 *
 * 3. REGISTRATION IS NOT MEMBERSHIP. Eligibility here is a cheap synchronous
 *    durable hint used to decide whether to install; every tool body re-derives
 *    the caller and re-authorizes from current facts, so a revoked child cannot
 *    keep using a tool that is still visible to it.
 *
 * What this module deliberately does NOT do: it never mounts a preset, never
 * installs the Pet root Skill allowlist, never registers `pet_context` or
 * `pet_locus_reply` (those stay with `registerPetTools` on locus children
 * only), and never wakes a model to announce that members changed.
 */

import type { Context } from '@deepseek-ai/cordis'
import { PetError } from '../errors.js'
import type { CollaborationCallerPorts, CollaborationLocusLookup } from './caller.js'
import type { CollaboratorDescription } from './collaborators.js'
import type { AuthoredCollaborationContext, CollaborationContextRecord } from './context.js'
import {
  registerCollaborationContextTool,
  registerCollaborationContextUpdateTool,
  registerCollaboratorsTool,
} from './tools.js'
import type { InquiryOriginProof } from '../inquiry/ask.js'
import type { InquiryRecord } from '../inquiry/ledger.js'
import {
  detectIsolatedQueuedTurnClaim,
  type IsolatedQueuedTurnClaimSupport,
} from '../inquiry/capability.js'
import { InquiryScheduler } from '../inquiry/scheduler.js'
import { registerInquiryAnswerTool, registerInquiryAskTool } from '../inquiry/tools.js'

/** Durable public-fact storage, as this assembly consumes it. */
export interface CollaborationContextStoreLike {
  get(parentSessionId: string): CollaborationContextRecord | undefined
  has(parentSessionId: string): boolean
  update(
    parentSessionId: string,
    replacement: unknown,
    verifiedAuthor: unknown,
  ): Promise<AuthoredCollaborationContext>
}

/** Durable inquiry ledger, as this assembly consumes it. */
export interface InquiryLedgerLike {
  accept(request: unknown, facts: unknown): Promise<InquiryRecord>
  get(inquiryId: string): InquiryRecord | undefined
  applyEvent(inquiryId: string, event: unknown): Promise<InquiryRecord>
  recordDiagnostic(inquiryId: string, entry: unknown): Promise<InquiryRecord>
}

/** Host seams this assembly needs. A missing one keeps the surface unpublished. */
export interface CollaborationAssemblySeams {
  /**
   * Whether the opened Pet Domain can commit an atomic batch.
   *
   * Both durable stores below recheck this themselves and reject, but a Host
   * without it must not publish tools whose every write is guaranteed to fail.
   */
  readonly atomicStorage: boolean
  /** Durable Locus indexes; the only source of circle membership. */
  readonly loci: CollaborationLocusLookup | undefined
  /** Cold session identity and archive facts; absent means no caller resolver. */
  readonly identity:
    | Partial<Pick<CollaborationCallerPorts, 'inspect' | 'isArchived'>>
    | undefined
  readonly contextStore: CollaborationContextStoreLike | undefined
  readonly ledger: InquiryLedgerLike | undefined
  /**
   * Cheap durable description of one member. MUST NOT read or summarize the
   * member's history; a throw is reported by the roster as `unknown`.
   */
  readonly describe: (sessionId: string) => CollaboratorDescription | undefined
  /**
   * Host-proven origin/audience of the work the caller is currently serving.
   * Returning `undefined` refuses the inquiry rather than defaulting to local.
   */
  readonly origin: (callerSessionId: string) => InquiryOriginProof | undefined
  /**
   * The Host's actual agent driver, read for the isolated queued-turn claim
   * marker. Anything else — including a missing service — is unavailable.
   */
  readonly agentLoop?: unknown
  /**
   * Behavioural corroboration of that marker.
   *
   * Deliberately injected rather than built here: a probe constructed from a
   * `dsh-agent` copy that is not the one the Host actually loaded would prove
   * nothing, and the capability audit records exactly that failure (a patched
   * `dsh-agent-loop` resolving against an unpatched `dsh-agent`). With no probe
   * the verdict stays unavailable, which is the correct answer.
   */
  readonly probeIsolatedClaim?: unknown
  /** Host clock; a model or client timestamp is never accepted as provenance. */
  readonly now?: () => number
  /** Host-owned identifier factory for inquiry and event ids. */
  readonly newId?: () => string
  /**
   * The Host's marker set for agent scopes that already carry this surface.
   *
   * Shared with the other Pet composition markers in `src/index.ts` on purpose:
   * a second registration of the same tool name throws
   * `tool "..." is already registered in this scope`, and an explicit marker is
   * the deduplication — never a swallowed duplicate-registration error.
   */
  readonly installed: WeakSet<object>
}

/** The composed surface, or nothing at all. */
export interface CollaborationAssembly {
  /**
   * Whether inquiries can actually be DISPATCHED on this Host.
   *
   * Today this resolves to unavailable: the isolated queued-turn claim seam is
   * written as a tracked compatibility patch but is not part of the pinned
   * runtime, so the driver carries no marker. Ask still accepts and durably
   * queues; nothing ever runs an inquiry turn.
   */
  readonly inquiryDispatch: IsolatedQueuedTurnClaimSupport
  /** The scheduler built with the REAL verdict above; it never re-probes. */
  readonly scheduler: InquiryScheduler
  /**
   * Cheap synchronous durable hint: is this session a main session or a current
   * Locus child of one? Used only to decide whether to install; the tool bodies
   * still re-derive and re-authorize the caller on every call.
   */
  eligible(sessionId: string): boolean
  /** Whether this exact agent scope already carries the surface. */
  isInstalled(scope: unknown): boolean
  /**
   * Install the surface on ONE agent scope.
   *
   * Idempotent through the shared marker. Throws when the scope exposes no
   * tools service, or when any registration fails — in which case every
   * registration already made is rolled back first, so a partially composed
   * surface is never published.
   */
  install(scope: unknown): void
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

/**
 * Compose the scoped collaboration + inquiry surface for this Host.
 * @param seams - Host-owned storage, identity and runtime seams.
 * @returns the assembly, or `undefined` when a required seam is unavailable.
 */
export function composeCollaborationSurface(
  seams: CollaborationAssemblySeams,
): CollaborationAssembly | undefined {
  const { loci, contextStore, ledger, identity, installed } = seams
  // Every one of these is load-bearing: without atomic batches the stores
  // reject every write, without the Locus indexes there is no membership, and
  // without cold identity the caller resolver cannot prove lineage. Publishing
  // tools that can only ever answer "unavailable" is the failure mode this
  // check exists to prevent.
  if (!seams.atomicStorage) return undefined
  if (loci === undefined || contextStore === undefined || ledger === undefined) return undefined
  if (typeof identity?.inspect !== 'function' || typeof identity.isArchived !== 'function') {
    return undefined
  }
  if (!(installed instanceof WeakSet)) return undefined

  const now = seams.now ?? Date.now
  const newId = seams.newId ?? (() => `inquiry-${Math.random().toString(36).slice(2)}`)

  const ports: CollaborationCallerPorts = {
    loci,
    inspect: identity.inspect,
    isArchived: identity.isArchived,
    // A throw here is a storage fault and must deny, not silently report "no
    // record"; the resolver converts it into the uniform unavailable answer.
    hasPublicContext: parentSessionId => contextStore.has(parentSessionId),
  }

  const inquiryDispatch = detectIsolatedQueuedTurnClaim({
    ...(seams.agentLoop === undefined ? {} : { agentLoop: seams.agentLoop }),
    ...(seams.probeIsolatedClaim === undefined
      ? {}
      : { probeIsolatedClaim: seams.probeIsolatedClaim }),
  })
  const scheduler = new InquiryScheduler({
    clock: { now },
    isolatedQueuedTurnClaim: inquiryDispatch,
  })

  /**
   * Roster description, narrowed by the dispatch verdict.
   *
   * While dispatch is unavailable no member can actually be asked anything, so
   * reporting a loaded sibling as `available` would invite a model to spend a
   * turn on an inquiry that can never run. `unknown` is the roster's documented
   * "reachability could not be proven, do not assume it is reachable" value, so
   * the member stays listed and identifiable while being visibly not-inquirable.
   * The title is kept: it is traceable metadata, not a reachability claim.
   */
  const describe = (sessionId: string): CollaboratorDescription | undefined => {
    const described = seams.describe(sessionId)
    if (inquiryDispatch.available) return described
    if (described === undefined) return undefined
    return described.title === undefined ? {} : { title: described.title }
  }

  /**
   * Answer storage.
   *
   * There is no durable answer table in the current Pet Domain, and adding one
   * is a schema version change that belongs with the dispatch work rather than
   * with this assembly. Rejecting is the honest composition: an answer that
   * only lived in memory would strand a requester on a promise a restart
   * erases. This path is unreachable today anyway — an answer is only accepted
   * for a DISPATCHED inquiry, and nothing can be dispatched.
   */
  const answers = {
    get: (): undefined => undefined,
    put: (): Promise<never> =>
      Promise.reject(
        new PetError('INTERNAL', 'No durable inquiry-answer medium is composed on this Host'),
      ),
  }

  const eligible = (sessionId: string): boolean => {
    try {
      if (!validId(sessionId)) return false
      const owned = loci.findByChildSessionId(sessionId)
      if (owned.length > 1) return false
      const row = owned[0]
      if (row !== undefined) {
        // A current Locus child of some main session.
        return row.state === 'active' && row.childSessionId === sessionId
      }
      // A reverse-index entry without its durable record is corruption; deny.
      if (loci.getLocusByChild(sessionId) !== undefined) return false
      // A main session qualifies through an established shared record (which
      // survives its last child leaving) or through a current active child.
      if (contextStore.has(sessionId)) return true
      return loci.listLociByParent(sessionId).some(candidate => candidate.state === 'active')
    } catch {
      // An unreadable index proves nothing, and installing on a guess would put
      // circle tools on a session whose membership was never established.
      return false
    }
  }

  const isInstalled = (scope: unknown): boolean =>
    typeof scope === 'object' && scope !== null && installed.has(scope)

  const install = (scope: unknown): void => {
    if (scope === null || typeof scope !== 'object') {
      throw new PetError('INTERNAL', 'Collaboration surface requires an agent scope')
    }
    if (installed.has(scope)) return
    const scoped = scope as Context
    // Resolve the service on THIS scope. `Context.get` answers without an
    // inject grant, which is what lets the synchronous locus-child boundary
    // decide before publication instead of racing an async inject callback.
    const tools = (scoped as unknown as { get(service: string): unknown }).get('tools')
    if (tools === undefined) {
      throw new PetError('INTERNAL', 'Agent scope exposes no tools service')
    }

    const disposers: (() => void)[] = []
    try {
      disposers.push(registerCollaborationContextTool(scoped, { ports, store: contextStore }))
      // The UPDATE tool goes to main sessions and Locus children alike: shared
      // facts are written by in-scope agents, and authorization is the Host's
      // caller-derived membership rather than the scope it was installed on.
      disposers.push(
        registerCollaborationContextUpdateTool(scoped, { ports, store: contextStore, now }),
      )
      disposers.push(registerCollaboratorsTool(scoped, { ports, describe }))
      disposers.push(
        registerInquiryAskTool(scoped, {
          ports,
          store: ledger,
          origin: seams.origin,
          now,
          newInquiryId: newId,
        }),
      )
      disposers.push(
        registerInquiryAnswerTool(scoped, {
          ports,
          ledger,
          answers,
          now,
          newEventId: newId,
        }),
      )
    } catch (error) {
      // Roll back in reverse order so the scope is left exactly as it was. A
      // half-registered surface would offer a model an ask with no answer, or a
      // roster with no shared facts, and no later pass would repair it.
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // Rollback is best effort; the original failure is what matters.
        }
      }
      throw error
    }
    installed.add(scope)
  }

  return { inquiryDispatch, scheduler, eligible, isInstalled, install }
}
