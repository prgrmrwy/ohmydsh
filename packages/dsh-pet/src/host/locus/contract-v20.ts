/**
 * The v20 locus contract (openspec pet-locus-isomorphic-entries, task group 1).
 *
 * Types, zod row schemas and repository / controller port SIGNATURES only. No
 * body lives here; the owners of group 2 implement them in their own scopes
 * (design D14) and delete the pre-v20 shapes they replace.
 *
 * Runtime imports are limited to `zod` and relative modules, none of which may
 * pull a `@deepseek-ai/*` runtime: the offline migration CLI imports this file
 * from `lib/` of an installed package, and the sync deploy check enforces it.
 * Type-only imports are erased and carry no such risk.
 *
 * Refusal vocabulary. Every port method that can refuse documents the exact
 * codes. A refusal rejects with an `Error` whose `code` property is one of
 * `PET_LOCUS_ERROR_CODES_V20` (wire.ts); no other code crosses these ports.
 */
import { z } from 'zod'
import { petLocusDeliveryBase, refineLocusDelivery, type PetLocusMainRecord } from '../spec.js'
import { containsStorageKeySeparator } from './storage-key.js'
import type { LocusDshPort, LocusLarkPort, LocusSpaceEstablishment } from './controller.js'
import type { PetLocusErrorCodeV20 } from '../../wire.js'

export type { PetLocusErrorCodeV20 as LocusErrorCodeV20 } from '../../wire.js'

/** Target storage-domain version. `spec.ts` still says 19 until group 2A bumps it. */
export const PET_DOMAIN_VERSION_V20 = 20

// ---------------------------------------------------------------------------
// Row schemas (design D1, D2)
// ---------------------------------------------------------------------------

export const LOCUS_STATES_V20 = ['not-created', 'active', 'invalid', 'stopped'] as const
export type LocusStateV20 = (typeof LOCUS_STATES_V20)[number]

export const LOCUS_ACCESS_MODES_V20 = ['read-only', 'danger-full-access'] as const
export type LocusAccessModeV20 = (typeof LOCUS_ACCESS_MODES_V20)[number]

const idPart = (name: string) =>
  z.string().min(1).refine(value => !containsStorageKeySeparator(value), `${name} may not contain the storage key separator`)

/**
 * Fields shared by group and topic rows. Every one has exactly one meaning
 * (D2). `sessionId` is the reserved id before creation and the created id
 * after; `state` says which.
 */
const rowCommon = {
  locusId: z.string().min(1),
  sessionId: z.string().min(1),
  state: z.enum(LOCUS_STATES_V20),
  accessMode: z.enum(LOCUS_ACCESS_MODES_V20),
  verifiedAt: z.number().int().nonnegative().optional(),
  grantedBy: z.string().min(1).optional(),
  /** Required; monotonic per entry; never reset by in-place rebuild or rebind. */
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  stoppedAt: z.number().int().nonnegative().optional(),
  invalidReason: z.string().optional(),
}

/** `invalidReason` is present iff `state === 'invalid'`; `stoppedAt` iff `state === 'stopped'`. */
function refineRowLifecycle(
  row: { state: LocusStateV20; invalidReason?: string | undefined; stoppedAt?: number | undefined },
  issueCtx: z.core.$RefinementCtx<unknown>,
): void {
  if ((row.state === 'invalid') !== (row.invalidReason !== undefined)) {
    issueCtx.addIssue({ code: 'custom', message: 'invalidReason is present iff state is invalid' })
  }
  if ((row.state === 'stopped') !== (row.stoppedAt !== undefined)) {
    issueCtx.addIssue({ code: 'custom', message: 'stoppedAt is present iff state is stopped' })
  }
}

/**
 * A group row: no `threadId`. The only row that stores M and the workspace.
 * Stored under the primary key `endpointKey({chatId})`, which is `chatId`.
 */
export const petLocusGroupRowV20 = z.strictObject({
  endpoint: z.strictObject({ chatId: idPart('chatId') }),
  ...rowCommon,
  locusMainSessionId: z.string().min(1),
  /** The project workspace of W: the allowed read root. */
  workspaceId: z.string().min(1),
  /** The archived W this chat was rebound from. Never cleared by later rebuilds. */
  reboundFrom: z.string().min(1).optional(),
  /** This group is its M's default Q&A group; at most one per M (set invariant). */
  defaultQa: z.literal(true).optional(),
}).superRefine(refineRowLifecycle)

/**
 * A topic row: has `threadId` and NO M / workspace / reboundFrom / defaultQa.
 * Strict, so a "topic on another M" cannot even be written (D1).
 */
export const petLocusTopicRowV20 = z.strictObject({
  endpoint: z.strictObject({ chatId: idPart('chatId'), threadId: idPart('threadId') }),
  ...rowCommon,
}).superRefine(refineRowLifecycle)

/** One `loci` row of v20, keyed by `endpointKey(chatId, threadId?)`. */
export const petLocusRowV20 = z.union([petLocusGroupRowV20, petLocusTopicRowV20])

export type LocusGroupRowV20 = z.infer<typeof petLocusGroupRowV20>
export type LocusTopicRowV20 = z.infer<typeof petLocusTopicRowV20>
export type LocusRowV20 = z.infer<typeof petLocusRowV20>

/** A topic row's M, defined by its group row. Returned where callers need both. */
export interface LocusResolvedRowV20<R extends LocusRowV20 = LocusRowV20> {
  readonly row: R
  readonly locusMainSessionId: string
  readonly workspaceId: string
}

// ---------------------------------------------------------------------------
// Delivery row (design D3): `sessionId` replaces `childSessionId`, no `generation`
// ---------------------------------------------------------------------------

export const petLocusDeliveryV20 = petLocusDeliveryBase
  .extend({ sessionId: z.string().min(1) })
  .superRefine(refineLocusDelivery)

export type LocusDeliveryRowV20 = z.infer<typeof petLocusDeliveryV20>

// ---------------------------------------------------------------------------
// Operation kinds (design D4, D6, D7, D8)
// ---------------------------------------------------------------------------

/**
 * Persisted `locus_operations.kind` values of v20. Gains `rebind` and
 * `migrate`. Access changes are NOT persisted (D8): no `access`, `permission`,
 * `tool-tier` or `anchor` kind. `replace`, `busy`, `retire` leave with the
 * concepts that produced them.
 */
export const LOCUS_OPERATION_KINDS_V20 = [
  'ensure',
  'ensure-default-qa',
  'rebuild',
  'stop',
  'invalidate',
  'delivery',
  'rebind',
  'migrate',
] as const
export type LocusOperationKindV20 = (typeof LOCUS_OPERATION_KINDS_V20)[number]

/** What `beginProvisioning` is called with (D4, D6, D7). Q&A is a `chat` that carries `defaultQa`. */
export type LocusProvisioningKindV20 = 'chat' | 'rebind' | 'migrate'

// ---------------------------------------------------------------------------
// Fences, set validation
// ---------------------------------------------------------------------------

/** Every write of a current row is a CAS on this pair (D3). */
export interface LocusRowFenceV20 {
  readonly expectedLocusId: string
  readonly expectedRevision: number
}

/** One violation found while validating a row set (D1, D12). */
export interface LocusSetViolationV20 {
  readonly code:
    | 'ROW_INVALID'
    | 'KEY_MISMATCH'
    | 'TOPIC_WITHOUT_GROUP'
    | 'DUPLICATE_LOCUS_ID'
    | 'DUPLICATE_SESSION_ID'
    | 'MULTIPLE_DEFAULT_QA'
    | 'GROUP_MAIN_UNPAIRED'
  /** The `loci` table key of the offending row. */
  readonly key: string
  readonly message: string
}

/**
 * `validateLocusSetForStorage` (D1, owner 2A.3). Pure; zod + relative imports
 * only, because the offline CLI calls it. `rows` are raw values keyed by `loci`
 * table key, `mainIds` is every `locus_mains` key (active and retired).
 * Checks: every row parses as {@link petLocusRowV20}; key equals
 * `endpointKey(chatId, threadId?)`; every topic has a group row with the same
 * `chatId`; `locusId` unique; `sessionId` unique across all rows; at most one
 * `defaultQa` per M; every group's M is in `mainIds`. Empty result = valid.
 * Where the implementation lives is open; see the hand-off notes.
 */
export type ValidateLocusSetForStorageV20 = (
  rows: ReadonlyMap<string, unknown>,
  mainIds: ReadonlySet<string>,
) => LocusSetViolationV20[]

// ---------------------------------------------------------------------------
// Provisioning (design D4)
// ---------------------------------------------------------------------------

export interface LocusProvisioningBeginV20 {
  readonly provisioningId: string
  readonly kind: LocusProvisioningKindV20
  readonly chatId: string
  readonly threadId?: string
  /** The work session (W) the chat is being established or rebound for. */
  readonly workSessionId?: string
  readonly startedAt: number
}

/** External resources recorded under one operation, for compensation (D4, D6, D7). */
export interface LocusProvisioningResourceV20 {
  /** The W Pet created itself (auto path). */
  readonly mainSessionId?: string
  /** The M (and its space) created by this operation; rebind / migrate reclaim only this. */
  readonly locusMainSessionId?: string
  readonly chatId?: string
}

/**
 * Rows of one chat publish: always a group row, optionally the first topic
 * row of the same `chatId`.
 */
export type LocusProvisionRowsV20 =
  | readonly [LocusGroupRowV20]
  | readonly [LocusGroupRowV20, LocusTopicRowV20]

export interface LocusCommitProvisioningInputV20 {
  readonly provisioningId: string
  readonly rows: LocusProvisionRowsV20
  /** The NEW M pairing; omit when publishing under an already active M. */
  readonly main?: PetLocusMainRecord
}

// ---------------------------------------------------------------------------
// resetChat, rebind, whole-W migrate (design D6, D7, D17)
// ---------------------------------------------------------------------------

export interface LocusResetChatOptionsV20 {
  /** The M the chat's group row moves to. */
  readonly toM: string
  readonly workspaceId?: string
  readonly reboundFrom?: string
  /** Rebind sets it; migrate leaves the `defaultQa` mark on the row. */
  readonly clearDefaultQa?: boolean
  /**
   * Per-row CAS values keyed by `endpointKey`. A row absent from the map is
   * fenced at the revision read inside the callback (see hand-off notes).
   */
  readonly expectedRevisions?: Readonly<Record<string, number>>
  readonly now: number
  /** Allocates each fresh reserved `sessionId` (`session-<uuid>`, never reused). */
  readonly reserveChildSessionId: () => string
}

export interface LocusResetChatResultV20 {
  /** Every row of the chat after the reset, group row first. */
  readonly rows: readonly LocusRowV20[]
  /** Uninjected backlog Deliveries retargeted to a new `sessionId`. */
  readonly retargetedDeliveryIds: readonly string[]
}

/**
 * What the caller's single repository write callback exposes. `resetChat` is
 * only reachable here, so it cannot be committed outside a caller transaction.
 */
export interface LocusWriteTxV20 {
  /**
   * D17. Inside the caller's transaction: write `locusMainSessionId = toM` (and
   * `workspaceId`, `reboundFrom`) on the group row; clear `defaultQa` when
   * asked; every non-`stopped` row of `chatId` gets a new reserved `sessionId`,
   * `state = not-created`, `accessMode = read-only`, `revision + 1`; `stopped`
   * rows stay `stopped` with `accessMode = read-only` and `revision + 1`;
   * retarget `accepted` backlog with no execution / inbox / turn evidence to
   * the new `sessionId`; `queued` / `running` / `finishing` are not retargeted.
   * Refuses with `LOCUS_NOT_FOUND` (no group row), `LOCUS_CONFLICT` (a row's
   * CAS failed), `LOCUS_BUSY` (the chat has a `current` Delivery or an entry is
   * in `accessChanging`). A refusal rolls the whole callback back.
   */
  resetChat(chatId: string, options: LocusResetChatOptionsV20): LocusResetChatResultV20
}

export interface LocusRebindChatInputV20 {
  readonly provisioningId: string
  readonly chatId: string
  /** Fence of the GROUP row. */
  readonly expectedLocusId: string
  readonly expectedRevision: number
  readonly toM: string
  /** The NEW M1 pairing; omit when `ensureLocusMain(W1)` found an existing active one. */
  readonly main?: PetLocusMainRecord
  /** The project workspace of W1. */
  readonly workspaceId: string
  /** The archived W the chat leaves. */
  readonly reboundFrom: string
  readonly now: number
  readonly reserveChildSessionId: () => string
}

export interface LocusMigrateWholeWInputV20 {
  readonly provisioningId: string
  readonly workSessionId: string
  /** The M1 pairing, always new (D7), `status: 'active'`. */
  readonly newMain: PetLocusMainRecord
  /** The W's currently active pairing, retired in the same transaction; omit when it has none. */
  readonly retireMain?: { readonly locusMainSessionId: string; readonly reason: string }
  /** Every chat of every pairing of W, with the per-row revisions the caller read. */
  readonly chats: readonly {
    readonly chatId: string
    /** The M the group row belonged to when read; the commit refuses if it moved (rebind). */
    readonly expectedMain?: string
    readonly expectedRevisions: Readonly<Record<string, number>>
  }[]
  readonly now: number
  readonly reserveChildSessionId: () => string
}

// ---------------------------------------------------------------------------
// D15 child lookup, D16 rotation
// ---------------------------------------------------------------------------

/** Input of the single `agent/created` lookup (D15). */
export interface LocusChildLookupInputV20 {
  readonly sessionId: string
  /** The durable preset of the created agent; decides branches 3 and 4. */
  readonly agentPreset?: string
  /** The staged first-creation reservation, when this creation was staged. */
  readonly staged?: {
    readonly sessionId: string
    readonly locusMainSessionId: string
    readonly revision: number
  }
}

/**
 * D15 decision, in order: `blocked` (0) → `active` (1) → `staged` (2) →
 * `retired` (3) → `ordinary` (4). Each hit carries the resolved M, since a topic
 * row has none of its own.
 */
export type LocusChildLookupResultV20 =
  | { readonly kind: 'blocked'; readonly reason: 'access-changing' | 'recovery-debt'; readonly locusId: string }
  | { readonly kind: 'active'; readonly row: LocusResolvedRowV20 }
  | { readonly kind: 'staged'; readonly row: LocusResolvedRowV20 }
  | { readonly kind: 'retired' }
  | { readonly kind: 'ordinary' }

export interface LocusRotateReservationInputV20 {
  readonly locusId: string
  /** The row revision observed when creation failed (CAS). */
  readonly expectedRevision: number
  /** The reservation that may have been consumed; must still be the row's `sessionId`. */
  readonly failedSessionId: string
  readonly reserveChildSessionId: () => string
  /**
   * Pre-prompt image rejection only (D16 exception): this trigger Delivery is
   * retargeted to the new reservation instead of settling on the old one.
   */
  readonly retargetDeliveryId?: string
  readonly now: number
}

export interface LocusRotateReservationResultV20 {
  readonly row: LocusRowV20
  readonly retargetedDeliveryIds: readonly string[]
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

/**
 * The v20 repository surface the controller, access mutation and
 * `agent/created` wiring depend on (owner 2A implements). Reads are
 * synchronous like the durable repository's; writes are queued by it.
 */
export interface LocusRepositoryPortV20 {
  // ---- reads --------------------------------------------------------------

  /** D12. `getLocus(locusId)` is a full scan of `loci`: there is no `locus-id` index. */
  getLocus(locusId: string): LocusRowV20 | undefined
  /** The row stored under `endpointKey`. */
  getRow(endpoint: { readonly chatId: string; readonly threadId?: string }): LocusRowV20 | undefined
  /** Group row first, then topic rows; empty when the chat has no group row. */
  listRowsOfChat(chatId: string): readonly LocusRowV20[]
  /** D12 `parent-loci`: the group rows whose M is `locusMainSessionId`. */
  listGroupRowsOfMain(locusMainSessionId: string): readonly LocusGroupRowV20[]
  /** D12/D15 `child-locus`: the row whose `sessionId` is this, or `undefined`. */
  findBySessionId(sessionId: string): LocusResolvedRowV20 | undefined
  /** D2/D12: W's active M → `parent-loci` → the group row carrying `defaultQa`. */
  findDefaultQa(workSessionId: string): LocusGroupRowV20 | undefined
  findMain(locusMainSessionId: string): PetLocusMainRecord | undefined
  findActiveMain(workSessionId: string): PetLocusMainRecord | undefined
  /** D7 migrate: every pairing of W in `locus_mains`, ACTIVE AND RETIRED. */
  listPairingsOfWork(workSessionId: string): readonly PetLocusMainRecord[]
  /** D6 step 5 / D17: a `current` Delivery (`queued` / `running` / `finishing` included) exists in the chat. Backlog does not count. */
  hasCurrentDeliveryInChat(chatId: string): boolean
  /** D8/D10 idle proof: any non-terminal Delivery exists for the entry. */
  hasNonTerminalDelivery(locusId: string): boolean
  /** D15 branch 0 / D8: blocking first-creation recovery debt (publishing / compensating / needs-recovery). */
  hasFirstDeliveryRecoveryDebt(locusId: string): boolean

  // ---- provisioning -------------------------------------------------------

  /** D4. Rejects before any external creation when atomic persistence is unavailable. */
  beginProvisioning(input: LocusProvisioningBeginV20): Promise<void>
  recordProvisioningResource(provisioningId: string, resource: LocusProvisioningResourceV20): Promise<void>
  completeProvisioning(provisioningId: string): Promise<void>
  /**
   * `reclaimed: true` records that the caller's rollback already released every
   * resource the operation created: the operation is `compensated`, so the
   * endpoint is not blocked. Otherwise it stays `failed` with its refs for the
   * window-then-compensate path.
   */
  failProvisioning(provisioningId: string, reason: string, options?: { readonly reclaimed?: true }): Promise<void>

  /**
   * D4. ONE transaction publishes the group row and the optional topic row
   * (and `main` when given) and marks the operation committed; rolls back as a
   * unit. Refuses with `INVALID_REQUEST` (a row fails {@link petLocusRowV20}, the
   * resulting set fails `validateLocusSetForStorage`, or the topic's `chatId`
   * differs from the group's) and `LOCUS_CONFLICT` (an entry row already exists
   * for one of the keys, or the provisioning operation is unknown).
   */
  commitProvisioning(input: LocusCommitProvisioningInputV20): Promise<readonly LocusRowV20[]>

  /**
   * D4 "群已存在" branch. Appends a topic row under an existing group row. No
   * provisioning operation (nothing external is created). Not in the task 1.4
   * list; see the hand-off notes. Refuses with `LOCUS_NOT_FOUND` (no group row
   * for `chatId`) and `LOCUS_CONFLICT` (the topic row already exists).
   */
  addTopicRow(row: LocusTopicRowV20): Promise<LocusTopicRowV20>

  /**
   * D17 host. Runs `body` as one repository write callback: it reads the latest
   * rows and delivery table, and everything `body` does through `tx` commits
   * or rolls back together.
   */
  write<T>(body: (tx: LocusWriteTxV20) => T): Promise<T>

  /**
   * D6, repository half. One transaction: optional `main` activation, then
   * `resetChat(chatId, {toM, workspaceId, reboundFrom, clearDefaultQa: true})`,
   * and the operation committed. Refuses with `LOCUS_NOT_FOUND` (no group row),
   * `LOCUS_CONFLICT` (group-row fence mismatch), `LOCUS_BUSY` (a `current`
   * Delivery in the chat, or an entry in `accessChanging`). The
   * `INVALID_REQUEST` checks of D6 (W archived, target eligibility) are the
   * controller's and run BEFORE this call. Whole transaction rolls back on any
   * refusal.
   */
  rebindChat(input: LocusRebindChatInputV20): Promise<LocusResetChatResultV20>

  /**
   * D7, whole-W migrate commit. One transaction: the W's active pairing (if
   * any) → `retired`, `newMain` → `active`, then `resetChat({toM: newMain})` per
   * chat. Refuses with `LOCUS_CONFLICT` (a row CAS or the active-pairing
   * expectation failed), `LOCUS_BUSY` (any chat has a `current` Delivery, or an
   * entry is in `accessChanging`) and `INVALID_REQUEST` (the resulting set is
   * invalid, or `newMain` is not a new `active` pairing for this W). The
   * whole transaction rolls back on any refusal; the old pairing is untouched.
   */
  commitWholeWMigration(input: LocusMigrateWholeWInputV20): Promise<readonly LocusResetChatResultV20[]>

  // ---- single-row lifecycle (D7, CAS on the fence) --------------------------

  /** D7. Idle-only stop; stopping a group row does not stop its topic rows. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`, `LOCUS_BUSY` (non-terminal Delivery or `accessChanging`). */
  stopRow(fence: LocusRowFenceV20, now: number): Promise<LocusRowV20>
  /**
   * D7. Same-W `/bind` of a `stopped` row: reset to `not-created` with a fresh
   * reservation, `accessMode = read-only`, `revision + 1`. Group row restarts only
   * itself. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`, `LOCUS_BUSY`.
   */
  reenableRow(fence: LocusRowFenceV20, now: number, reserveChildSessionId: () => string): Promise<LocusRowV20>
  /** D7 class A. Host-judged child loss: mark the row `invalid` with a reason. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`. */
  markInvalid(fence: LocusRowFenceV20, reason: string, now: number): Promise<LocusRowV20>
  /**
   * D7. In-place rebuild of an `invalid` row on the next authorized @: same row,
   * same `locusId`, fresh reservation, `state = not-created`, `accessMode =
   * read-only`, `revision + 1`; uninjected backlog retargeted. `LOCUS_NOT_FOUND`,
   * `LOCUS_CONFLICT`, `LOCUS_BUSY` (current Delivery or `accessChanging`).
   */
  rebuildRowInPlace(fence: LocusRowFenceV20, now: number, reserveChildSessionId: () => string): Promise<LocusRowV20>

  // ---- access change fence (D8) ---------------------------------------------

  /**
   * D8 steps 1 and 5. A short operation INSIDE the write queue: re-check that
   * the entry has no non-terminal Delivery and is not already in the
   * `accessChanging` set, add it, and return `{locusId, revision}`. Not held
   * across external work. Refuses with `LOCUS_NOT_FOUND`, `INVALID_REQUEST` (row is `stopped` or `invalid`: only `not-created` and `active` rows accept an access change) and `LOCUS_BUSY`.
   * With `expectedRevision` (the management client's fence), the row's revision
   * is compared INSIDE the queue and a mismatch refuses with `LOCUS_CONFLICT`
   * before anything is drained; IM `/access` has no client fence and omits it.
   */
  acquireAccessChange(locusId: string, expectedRevision?: number): Promise<{ readonly locusId: string; readonly revision: number }>
  /** D8 step 5 (`finally`). Idempotent; never refuses. */
  releaseAccessChange(locusId: string): void
  /**
   * D8. Membership of the `accessChanging` set. Checked inside the queue
   * callbacks of `acceptDelivery`, stop, rebind, migrate and in-place rebuild,
   * and at the `agent/created` publish boundary (D15 branch 0).
   */
  isAccessChanging(locusId: string): boolean
  /**
   * D8 step 4. CAS write of `accessMode`, `grantedBy`, `revision + 1`, with
   * `verifiedAt` cleared. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`, `INVALID_REQUEST` (row `stopped` or `invalid`). Does not check
   * the set itself: the caller holds the acquisition.
   */
  setAccessMode(
    fence: LocusRowFenceV20,
    mode: LocusAccessModeV20,
    grantedBy: string,
    now: number,
  ): Promise<LocusRowV20>
  /**
   * D8 assembly: record that `composeLocusChild` applied the row's
   * `accessMode` and read it back. Writes `verifiedAt = now`. CAS on the fence
   * AND `accessMode` (a change that landed after this assembly read the row
   * must not be stamped verified). Does NOT bump `revision`: a wake must not
   * stale a fence the management panel holds. Called by the `agent/created`
   * wiring after a composed result and BEFORE publication; any refusal refuses
   * publication (class B). `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT` (revision moved
   * or `accessMode` differs). Added 2026-11-06 with lead approval.
   */
  recordAccessVerified(
    fence: LocusRowFenceV20,
    accessMode: LocusAccessModeV20,
    now: number,
  ): Promise<LocusRowV20>

  // ---- first creation (D15, D16) --------------------------------------------

  /** D15. The one lookup `agent/created` performs; see {@link LocusChildLookupResultV20}. */
  lookupChildForAgentCreated(input: LocusChildLookupInputV20): LocusChildLookupResultV20
  /**
   * D16. Atomically reserve a new `sessionId` after a creation failure that may
   * have consumed the old one: `revision + 1`, `accessMode` and `state` kept;
   * uninjected backlog retargeted; the failed Delivery keeps its old association.
   * Refuses with `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT` (revision moved or
   * `failedSessionId` is no longer the row's `sessionId`).
   */
  rotateReservation(input: LocusRotateReservationInputV20): Promise<LocusRotateReservationResultV20>

  // ---- first-child publication (D15, D16; added 2026-11-06 with lead approval) ----

  /**
   * Inside `agent/created`, after a composed result. The row must be
   * `not-created` with this `sessionId` and `revision`; the Delivery must be the
   * exact unissued current of this entry. Atomically: row → `active`
   * (`accessMode` unchanged, `revision` KEPT so the staged tuple and management
   * fence stay valid), Delivery gains `executionId`, and the first-publication
   * operation `first-child:<executionId>` is written in phase `publishing` with
   * `expectedRevision = revision` and `resourceRefs {parentSessionId: group M,
   * childSessionId: sessionId}` (read by startup recovery). A throw leaves
   * nothing published and vetoes creation. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`,
   * `LOCUS_BUSY` (entry in `accessChanging`).
   */
  publishFirstDelivery(input: LocusFirstDeliveryIdentityV20 & {
    readonly executionId: string
  }): Promise<void>
  /**
   * After `startActivation` returned and the first prompt is bound: close the
   * publication operation. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`.
   */
  commitFirstDelivery(input: { readonly executionId: string; readonly now: number }): Promise<void>
  /**
   * Undo a completed `publishFirstDelivery` (also the startup-recovery path for a
   * `publishing` operation, after the child compensator succeeded). One write:
   * - default: row back to `not-created` with a NEW `sessionId`, `revision + 1`,
   *   `accessMode` and `grantedBy` kept, `verifiedAt` cleared; this Delivery is
   *   settled `failed` on its OLD `sessionId`; uninjected backlog retargeted;
   *   operation `compensated`.
   * - `retryText: true` — the D16 pre-prompt image exception: same rotation, but
   *   THIS Delivery is retargeted to the new reservation unsettled and marked
   *   image-route-rejected, and becomes an UNISSUED current again: `executionId`
   *   (and any inbox/turn binding) is cleared; status and queue state stay
   *   `current`; deadline and sequence are kept. The channel's text retry
   *   requires exactly that state (locus-controller.ts text-fallback path).
   * - `recoveryDebt: true` — release is unprovable: no rotation; the live
   *   publication is revoked and debt is left that `hasFirstDeliveryRecoveryDebt`
   *   reports, so D15 step 0 vetoes any later publication.
   * `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`.
   */
  revertFirstDelivery(input: LocusFirstDeliveryIdentityV20 & {
    readonly executionId?: string
    readonly retryText?: true
    readonly recoveryDebt?: true
    /** Required unless `recoveryDebt`; the allocator of the new reservation. */
    readonly reserveChildSessionId?: () => string
  }): Promise<void>
  /**
   * D16 non-capacity failure BEFORE publication: settle this Delivery `failed`
   * on the old `sessionId`, then rotate exactly as {@link rotateReservation}
   * (`revision + 1`, `accessMode`, `grantedBy`, `state` kept). A capacity refusal
   * calls nothing. `LOCUS_NOT_FOUND`, `LOCUS_CONFLICT`.
   */
  failFirstDeliveryCreation(input: LocusFirstDeliveryIdentityV20 & {
    readonly reserveChildSessionId: () => string
  }): Promise<void>
}

/** The exact first-creation identity every first-publication write is fenced on. */
export interface LocusFirstDeliveryIdentityV20 {
  readonly locusId: string
  /** The row's reserved (then published) `sessionId`. */
  readonly sessionId: string
  /** The row revision read before publication. */
  readonly revision: number
  readonly deliveryId: string
  readonly now: number
}

// ---------------------------------------------------------------------------
// Controller dependencies
// ---------------------------------------------------------------------------

/** `LocusControllerDeps` of v20 (replaces `LocusControllerDeps` in `controller.ts`). */
export interface LocusControllerDepsV20 {
  readonly repository: LocusRepositoryPortV20
  readonly dsh: LocusDshPort
  /** Allocates a reserved `sessionId`; the same allocator feeds every reset / rotation. */
  readonly reserveChildSessionId?: () => string
  /** Creates the collab space of a new W/M pair. Absent makes every path that needs a new M fail closed. */
  readonly establishSpace?: (input: {
    readonly workSessionId: string
    readonly locusMainSessionId: string
  }) => Promise<LocusSpaceEstablishment>
  /** Required by Q&A creation. */
  readonly lark?: LocusLarkPort
  readonly now?: () => number
  readonly id?: () => string
  readonly log?: (message: string) => void
}

/** Narrowing helper for refusal handling: an error that carries a v20 code. */
export interface LocusRefusalV20 extends Error {
  readonly code: PetLocusErrorCodeV20
}
