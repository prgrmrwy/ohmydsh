/**
 * Versioned `dsh-pet` storage domain.
 *
 * Pet uses DSH's domain data form rather than a hand-written repository layer:
 * the spec is the single source of the durable layout, and zod validates every
 * record at the durable boundary so a malformed or version-mismatched medium
 * fails loud at open instead of silently producing partial state.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/**
 * Domain name; also the backend unit name and the storage-domain route key.
 *
 * Underscored, not `dsh-pet`: DSH's `UNIT_NAME_RE` (`/^[a-z][a-z0-9_]*$/`)
 * must stay safe as both a file name and an unescaped SQL identifier segment,
 * so a hyphen is rejected at module load. The route key in
 * `cordis.patch.yml` MUST use this exact spelling.
 */
export const PET_DOMAIN_NAME = 'dsh_pet'

/** Domain format version. A medium stamped with another version rejects at open. */
// Bumped to 2 when Skills became registered links instead of immutable
// copies: `skill_revisions.digest` became `sourcePath`,
// `skill_selections.enabledDigest` became `enabled`, and
// `invocations.skillDigest` became `skillSourcePath`. Rows written by v1
// cannot be upgraded in place — the store copies they referenced are gone —
// so `migrate.ts` clears the affected tables before the domain is opened.
//
// Bumped to 3 for the `workspace_env` table, plus the removal of
// `skill_revisions.pet` and the `builtinsInitialized` global. Unlike the v1→v2
// bump this is ADDITIVE: no existing row references anything that disappeared,
// and zod strips the two dropped keys on read, so v2 data loads unchanged and
// migration MUST NOT clear any table.
//
// Bumped to 4 for the Lark inbound channel: `channel_config`, `chat_bindings`
// and `invocation_channel`. ADDITIVE like v2→v3 — three new tables plus two
// new optional fields on existing records (`tasks.residentWorkspaceId`,
// which is absent on every pre-channel row, and the `chat` source kind that
// only channel-created Tasks use). v3 data loads unchanged and migration MUST
// NOT clear any table.
//
// Bumped to 5 for the QA group: `chat_bindings` gains `kind` (defaulted to
// `workspace` on read, so every v4 row keeps its meaning) plus the `qa*`
// reference fields, and Tasks gain the `qa-chat` source kind. ADDITIVE like
// v3→v4: no existing row references anything that disappeared, and migration
// MUST NOT clear any table.
//
// Bumped to 6 for the unified locus model. The new `loci`, `locus_indexes`,
// `locus_deliveries`, and `locus_operations` tables are additive: ordinary Pet
// rows (`tasks`, `invocations`, `snapshots`, `runs`, Skills, environment, and
// channel history) remain untouched and continue to validate as before. The new
// locus repository deliberately never reads `chat_bindings` or
// `invocation_channel`; those legacy tables remain in the medium as preserved
// history and are not converted, deleted, or used as a routing fallback.
//
// Bumped to 7 for durable source-switch notices (`locus_switch_notices`),
// additive in the same way: one new table, nothing converted or cleared. The
// notice has to outlive a restart because an endpoint whose source changed may
// not dispatch ordinary work until the entry has been told; a notice held only
// in memory would turn a crash into exactly the silent switch the spec forbids.
// Bumped to 8 for the append-only `locus_permission_audit` table. Additive
// in the same way: the locus row still holds the current permission, and the
// audit rows are the history that a later downgrade would otherwise erase.
// Bumped to 9 for owner-confirmed context anchor facts and the `anchor` WAL
// kind. Additive: existing locus rows remain valid and no history is rewritten.
export const PET_DOMAIN_VERSION = 9

// `chat` joins the original three for Tasks created by an inbound Lark
// message. It is a distinct scope kind rather than a flavour of `workspace`
// on purpose: two chats routed to the same workspace must NOT share a Task,
// and the spec requires chat scopes to be independent.
//
// `qa-chat` names a Task whose "executor" is a fork continuable child of a
// user session rather than a Pet-created root session. Distinct from `chat`
// because the two healing paths must never be confused: a `chat` Task heals
// a stale pointer by creating a NEW executor, while a `qa-chat` Task can
// never do that — a fresh executor would lose the inherited context that is
// the whole point of the QA group.
const petSourceKind = z.enum(['session', 'workspace', 'none', 'chat', 'qa-chat'])

const petTaskStatus = z.enum([
  'creating-executor',
  'idle',
  'running',
  'waiting-user',
  'failed',
  'recovering',
])

const petInvocationStatus = z.enum([
  'queued',
  'dispatching',
  'running',
  'waiting-user',
  'succeeded',
  'failed',
  'cancelled',
  'recovering',
])

const petTaskRecord = z.object({
  id: z.string().min(1),
  scopeKey: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  sourceKind: petSourceKind,
  sourceId: z.string().min(1).optional(),
  sourceTitle: z.string().optional(),
  sourceAvailability: z.enum(['available', 'archived', 'missing']),
  executorSessionId: z.string().min(1),
  /**
   * Workspace the executor session lives IN, for workspace-resident Tasks.
   *
   * Absent on every ordinary Task: those run in the dedicated `DSH Pet`
   * workspace and reach their source through the trusted snapshot instead.
   * Present only when a channel route placed the executor directly inside a
   * target workspace, where Pet does NOT promise its Skill-allowlist
   * projection or standing instructions.
   */
  residentWorkspaceId: z.string().min(1).optional(),
  status: petTaskStatus,
  diagnostic: z.string().optional(),
  archivedAt: z.number().int().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  revision: z.number().int().nonnegative(),
})

const petInvocationRecord = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  capabilityId: z.string().min(1),
  // Optional since v4: a conversational Invocation raised by an inbound
  // channel message carries a question rather than a Skill to run. Every
  // capability-driven Invocation still records all three.
  skillName: z.string().min(1).optional(),
  skillSourcePath: z.string().min(1).optional(),
  skillSetGeneration: z.number().int().nonnegative().optional(),
  snapshotId: z.string().min(1),
  request: z.string().optional(),
  status: petInvocationStatus,
  queuePosition: z.number().int().nonnegative(),
  resultSummary: z.string().optional(),
  errorSummary: z.string().optional(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  revision: z.number().int().nonnegative(),
})

const petSourceSnapshot = z.object({
  id: z.string().min(1),
  invocationId: z.string().min(1),
  sourceKind: petSourceKind,
  sourceSessionId: z.string().optional(),
  sourceWorkspaceId: z.string().optional(),
  sessionTitle: z.string().optional(),
  workspaceTitle: z.string().optional(),
  cwd: z.string().optional(),
  asOfSeq: z.number().int().optional(),
  worktree: z
    .object({
      executionRoot: z.string(),
      branch: z.string().optional(),
      dependencyMode: z.string().optional(),
      lifecycle: z.string().optional(),
    })
    .optional(),
  scm: z
    .object({
      branch: z.string().optional(),
      head: z.string().optional(),
      remote: z.string().optional(),
    })
    .optional(),
  capturedAt: z.number().int(),
})

const petRunRecord = z.object({
  id: z.string().min(1),
  invocationId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: petInvocationStatus,
  errorSummary: z.string().optional(),
  startedAt: z.number().int(),
  settledAt: z.number().int().optional(),
})

// One registration per Skill, keyed by name. A Skill is the user's own
// directory rather than an immutable copy, so there are no revisions to
// version, compare or garbage-collect.
const petSkillRevision = z.object({
  skillName: z.string().min(1),
  /** Canonical directory on the Host that the projection links to. */
  sourcePath: z.string().min(1),
  description: z.string(),
  // NOTE: a `pet` block used to live here, carrying label/icon/context read
  // from SKILL.md frontmatter. It was removed so no Skill can adapt itself to
  // Pet. Rows written before that still hold the key; zod STRIPS undeclared
  // keys on read, so they load cleanly and simply lose the declaration.
  // Free-text arguments appended after the skill token on every dispatch.
  // A field absent from this schema is STRIPPED on read: the record is
  // validated coming back out, so an undeclared key survives the write and
  // then vanishes, which looks exactly like a persistence failure.
  arguments: z.string().optional(),
  provenance: z.object({
    kind: z.literal('local-link'),
    sourcePath: z.string().optional(),
    installedAt: z.number().int(),
  }),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
})

const petSkillSelection = z.object({
  skillName: z.string().min(1),
  /** Present when the Skill is enabled; a Skill has no versions to pick. */
  enabled: z.boolean().optional(),
  showAsShortcut: z.boolean(),
})

/**
 * Reserved scope naming the global environment set.
 *
 * A DSH workspace id is generated and never this literal, so the two can
 * share one column without ambiguity.
 */
export const PET_ENV_GLOBAL_SCOPE = 'global'

/**
 * Shape every environment variable name must take.
 *
 * Upper snake case, matching the environment-variable convention. Validated on
 * WRITE rather than skipped at injection: a key stored in some other shape
 * would be silently absent from the child environment, which reads as "my
 * config does nothing" with no diagnostic.
 */
export const PET_ENV_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/

/**
 * One environment entry, keyed by `scope + key`.
 *
 * `scope` is either {@link PET_ENV_GLOBAL_SCOPE} or a workspace id. The two
 * scopes are independent rows: a workspace entry OVERRIDES a global one of the
 * same key at injection time, but neither overwrites the other in storage.
 */
const petEnvEntry = z.object({
  scope: z.string().min(1),
  key: z.string().regex(PET_ENV_KEY_PATTERN),
  value: z.string().min(1),
  updatedAt: z.number().int(),
})


/**
 * Shape an open_id must take.
 *
 * Validated on WRITE so an unresolvable allowlist entry fails at configuration
 * time rather than silently admitting nobody at runtime. Lark open ids are
 * `ou_` followed by hex-ish characters; the prefix is the part that matters.
 */
export const PET_OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]+$/

/** Shape a chat id must take (`oc_` prefix for both group and p2p chats). */
export const PET_CHAT_ID_PATTERN = /^oc_[A-Za-z0-9]+$/

/** Single-row key for {@link petChannelConfig}. */
export const PET_CHANNEL_CONFIG_KEY = 'channel'

/**
 * Lark channel configuration. Exactly one row, keyed by
 * {@link PET_CHANNEL_CONFIG_KEY}.
 *
 * Holds NO credentials by contract: the bot's app secret and tokens live in
 * `lark-cli` and Pet never reads them. `botAppId`/`botOpenId` are identity
 * facts used to prove which bot is bound and to decide whether an inbound
 * mention targets us; neither is a secret.
 */
const petChannelConfig = z.object({
  /** Disabled until the user explicitly turns the channel on. */
  enabled: z.boolean(),
  /** Bound bot's app id, as reported by `lark-cli auth status`. */
  botAppId: z.string().min(1).optional(),
  /**
   * Bound bot's own open_id.
   *
   * Required for group mention filtering: without it Pet cannot tell an
   * `@us` from an `@someone-else`, and the spec requires failing closed
   * rather than treating every mention as ours.
   */
  botOpenId: z.string().regex(PET_OPEN_ID_PATTERN).optional(),
  /** Display name of the bound bot, for the settings summary only. */
  botName: z.string().optional(),
  /**
   * Senders permitted to trigger, as resolved open_ids.
   *
   * Stored resolved rather than as usernames: the inbound event carries an
   * open_id, so a username kept here could only be compared by guessing.
   * An entry that cannot be resolved is rejected at write time.
   */
  allowOpenIds: z.array(z.string().regex(PET_OPEN_ID_PATTERN)),
  /** Workspace used when a chat has no explicit binding row. */
  defaultWorkspaceId: z.string().min(1).optional(),
  /**
   * Display names learned for known open_ids, for the settings list only.
   *
   * A cache, never an authority: admission always compares open_ids. Names
   * are picked up from message history as people trigger work, because an
   * `ou_…` string tells a reader nothing about who it is.
   */
  knownNames: z.record(z.string(), z.string()).optional(),
  /** Persisted safe subset of a recoverable channel failure. */
  channelDiagnostic: z
    .object({
      kind: z.literal('permission-missing'),
      code: z.number().int().optional(),
      missingScopes: z.array(z.string()),
      consoleUrl: z.string().optional(),
      updatedAt: z.number().int(),
    })
    .optional(),
  /** Durable owner-facing evidence that bot-added authorization was unproven. */
  lifecycleDiagnostic: z
    .object({
      kind: z.literal('bot-added-unverified'),
      updatedAt: z.number().int(),
    })
    .optional(),
  updatedAt: z.number().int(),
})

/**
 * One chat's route and its current active Task pointer.
 *
 * Group and p2p chats share this table; `chatType` distinguishes them. A row
 * appears either because the user bound it in Settings or because an inbound
 * message routed through the default and Pet wrote the result back
 * (`boundBy: 'auto'`).
 *
 * p2p rows can ONLY be created by an inbound message: bot identity is barred
 * from listing p2p chats, so their `chatId` is unknowable until one arrives.
 *
 * Since v5 a binding carries a `kind`. `workspace` (the default every v4 row
 * reads as) routes to a registered workspace and behaves exactly as before.
 * `qa` routes to a fork continuable child of a user session: created ONLY by
 * the Q&A action (never written back by an inbound message), exempt from the
 * global sender allowlist, and never re-bindable to a workspace target. The
 * kind-specific shape is enforced by `superRefine` rather than a union so a
 * v4 row — which has no `kind` key at all — still parses through the default.
 */
const petChatBinding = z
  .object({
    chatId: z.string().regex(PET_CHAT_ID_PATTERN),
    chatType: z.enum(['p2p', 'group']),
    /** Binding kind; absent on every v4 row, which reads as `workspace`. */
    kind: z.enum(['workspace', 'qa']).default('workspace'),
    /** Route target for `workspace` rows. Always a workspace id, never a raw path. */
    workspaceId: z.string().min(1).optional(),
    /**
     * Task currently serving this chat, when one exists.
     *
     * A POINTER, not ownership: it may go stale (archived, deleted). Consumers
     * re-verify the Task and heal the pointer rather than trusting it.
     */
    activeTaskId: z.string().min(1).optional(),
    /** Human-readable chat name, cached for the settings list only. */
    chatName: z.string().optional(),
    /** Fork child session serving a `qa` binding; the route target for qa rows. */
    qaChildSessionId: z.string().min(1).optional(),
    /** Source session the qa child was forked from; the resume target. */
    qaParentSessionId: z.string().min(1).optional(),
    /**
     * When the qa binding was invalidated (source session gone, resume
     * refused), with the reason. Presence means inbound messages no longer
     * raise work; the child session and its history remain readable.
     */
    qaInvalidatedAt: z.number().int().optional(),
    qaInvalidatedReason: z.string().optional(),
    /**
     * Managed execution root the qa child must work in.
     *
     * Resolved ONCE at group creation from the source session's Worktree
     * Session binding — never inferred from a `cwd`, which that plugin
     * deliberately leaves at the repository root. Stored because every later
     * question must restate it: a fork inherits no binding of its own, so
     * without this the child's literal cwd (the main checkout) silently
     * becomes its real working directory. Absent for an unbound source
     * session, which is the ordinary non-worktree case.
     */
    qaExecutionRoot: z.string().min(1).optional(),
    /** Task branch of that execution root, for the same prompt. */
    qaBranch: z.string().min(1).optional(),
    /** Repository root, named in the prompt as the place NOT to work in. */
    qaRepositoryRoot: z.string().min(1).optional(),
    /**
     * How this qa binding came to exist.
     *
     * `created` — Pet built the group itself through the Q&A action, so it is
     * the creator and the group is owned by the user Pet invited.
     * `bound` — an existing group was attached with `/bind`; Pet is neither
     * its creator nor its owner and holds no group-management capability
     * there.
     *
     * Purely presentational: no downstream behaviour branches on it. It exists
     * so Settings and diagnostics can state which case a row is instead of
     * implying Pet can manage a group it merely joined. Absent on every
     * pre-`/bind` row, which reads as `created`.
     */
    qaOrigin: z.enum(['created', 'bound']).default('created'),
    /**
     * The workspace this chat routed to before `/bind` took it over.
     *
     * Present only when `/bind` overwrote an existing `workspace` row.
     * `/unbind` restores it, so releasing a group hands it back to whatever
     * it was doing rather than leaving it permanently mute — a group that was
     * a workspace group before should be one again afterwards.
     */
    qaPriorWorkspaceId: z.string().min(1).optional(),
    boundBy: z.enum(['auto', 'user']),
    boundAt: z.number().int(),
  })
  .superRefine((row, issueCtx) => {
    // Enforced at the durable boundary so a half-written row fails loud on
    // open instead of silently routing nowhere.
    if (row.kind === 'workspace' && (row.workspaceId === undefined || row.workspaceId === '')) {
      issueCtx.addIssue({ code: 'custom', message: 'workspace binding requires workspaceId' })
    }
    if (row.kind === 'qa') {
      if (row.qaChildSessionId === undefined)
        issueCtx.addIssue({ code: 'custom', message: 'qa binding requires qaChildSessionId' })
      if (row.qaParentSessionId === undefined)
        issueCtx.addIssue({ code: 'custom', message: 'qa binding requires qaParentSessionId' })
    }
  })

/**
 * Trusted reply target for one channel-triggered Invocation.
 *
 * This is the Channel Binding the dsh-pet spec reserved: an outbound reply
 * resolves its destination by looking up the CALLING executor session's
 * current Invocation and reading this row. No model-supplied chat, thread or
 * user id is ever accepted, so the row is the only authority for "where does
 * this answer go".
 */
const petInvocationChannel = z.object({
  invocationId: z.string().min(1),
  chatId: z.string().regex(PET_CHAT_ID_PATTERN),
  chatType: z.enum(['p2p', 'group']),
  /** Message that triggered this Invocation; the reply anchor. */
  triggerMessageId: z.string().min(1),
  /** Thread root, when the trigger arrived inside a thread. */
  rootMessageId: z.string().min(1).optional(),
  /** Who triggered it; already proven to be on the allowlist. */
  senderOpenId: z.string().regex(PET_OPEN_ID_PATTERN),
  senderName: z.string().optional(),
  /**
   * In-progress reaction placed on the trigger message.
   *
   * Needed to REMOVE it later: Lark's delete API takes message id plus
   * reaction id. Absent when the reaction call failed, which is tolerated —
   * reaction work is fail-soft and never blocks execution.
   */
  reactionId: z.string().min(1).optional(),
  /**
   * When terminal feedback was applied to the trigger message.
   *
   * The explicit "已反馈" marker. Presence of `reactionId` cannot serve as
   * one: the reaction is written AFTER the work is dispatched, so a fast turn
   * can settle before it lands, and a binding awaiting feedback would look
   * identical to one that never got a reaction at all.
   */
  settledAt: z.number().int().optional(),
  createdAt: z.number().int(),
})

/**
 * Domain global: Pet-wide configuration and the monotonic skill-set generation
 * that fences catalog republication.
 *
 * `initial` is non-null by contract: backends use `null` as the "never
 * written" sentinel, so a nullable global could not survive a reopen.
 */
/**
 * Unified locus endpoint and permission records. These schemas intentionally
 * live beside the new tables instead of changing the legacy channel rows: the
 * locus model is a new durable surface and does not reinterpret old bindings.
 */
export const petLocusEndpoint = z.object({
  chatId: z.string().min(1).refine(value => !value.includes('\u0000'), 'chatId may not contain NUL'),
  threadId: z
    .string()
    .min(1)
    .refine(value => !value.includes('\u0000'), 'threadId may not contain NUL')
    .optional(),
})

export const petLocusPermission = z
  .object({
    desired: z.enum(['read', 'write']),
    effective: z.enum(['read', 'write']),
    verifiedAt: z.number().int().nonnegative().optional(),
    grantedBy: z.string().min(1).optional(),
  })
  .superRefine((permission, issueCtx) => {
    if (permission.effective === 'write' && permission.desired !== 'write') {
      issueCtx.addIssue({ code: 'custom', message: 'effective write requires desired write' })
    }
    if (permission.effective === 'write' && permission.verifiedAt === undefined) {
      issueCtx.addIssue({ code: 'custom', message: 'effective write requires verifiedAt' })
    }
  })

/** One immutable-or-transitioned generation of a unified locus association. */
export const petLocusRecord = z.object({
  id: z.string().min(1),
  generation: z.number().int().positive(),
  endpoint: petLocusEndpoint,
  parentSessionId: z.string().min(1),
  childSessionId: z.string().min(1).optional(),
  workspaceId: z.string().min(1),
  parentLocusId: z.string().min(1).optional(),
  source: z.enum(['auto', 'inherited', 'explicit', 'qa-created']),
  state: z.enum(['provisioning', 'active', 'switching', 'invalid', 'stopped', 'retired']),
  permission: petLocusPermission,
  /** Optional optimistic fence; old/new pure locus records may omit it. */
  revision: z.number().int().nonnegative().optional(),
  /** Confirmed caller-bound execution anchor, never inferred from cwd. */
  contextAnchor: z
    .object({
      status: z.enum(['confirmed', 'missing', 'unknown']),
      existence: z.enum(['exists', 'missing', 'unknown']).optional(),
      authorization: z.enum(['authorized', 'unauthorized', 'unknown']).optional(),
      executionRoot: z.string().min(1).optional(),
      projectResources: z.array(z.string().min(1)).optional(),
      constraints: z.array(z.string()).optional(),
      provenance: z.string().min(1).optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
    })
    .optional(),
  busy: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  retiredAt: z.number().int().nonnegative().optional(),
  stoppedAt: z.number().int().nonnegative().optional(),
  invalidReason: z.string().optional(),
  replacesLocusId: z.string().min(1).optional(),
}).superRefine((record, issueCtx) => {
  if (record.endpoint.threadId !== undefined && record.parentLocusId === undefined) {
    issueCtx.addIssue({ code: 'custom', message: 'topic locus requires parentLocusId' })
  }
  if (record.endpoint.threadId === undefined && record.parentLocusId !== undefined) {
    issueCtx.addIssue({ code: 'custom', message: 'chat-level locus cannot carry parentLocusId' })
  }
})

/**
 * A materialized reverse/current index. The repository treats `loci` as the
 * source of truth and rebuilds these records on every locus mutation.
 */
export const petLocusIndex = z.object({
  kind: z.enum(['endpoint-current', 'parent-loci', 'child-locus', 'default-qa']),
  key: z.string().min(1),
  locusIds: z.array(z.string().min(1)).min(1),
  updatedAt: z.number().int().nonnegative(),
})

/** Durable association between one accepted platform message and one child turn. */
export const petLocusDelivery = z.object({
  deliveryId: z.string().min(1),
  messageId: z.string().min(1),
  endpoint: petLocusEndpoint,
  locusId: z.string().min(1),
  generation: z.number().int().positive(),
  childSessionId: z.string().min(1),
  senderOpenId: z.string().min(1),
  senderName: z.string().optional(),
  text: z.string().min(1).optional(),
  replyTarget: petLocusEndpoint.extend({
    messageId: z.string().min(1),
    rootMessageId: z.string().min(1).optional(),
  }).optional(),
  rootMessageId: z.string().min(1).optional(),
  replyToMessageId: z.string().min(1).optional(),
  sequence: z.number().int().positive(),
  status: z.enum(['accepted', 'queued', 'running', 'settled', 'failed']),
  /** Accepted rows have no proof; queued binds execution; running/terminal bind turn. */
  feedbackTarget: petLocusEndpoint.extend({
    messageId: z.string().min(1),
    rootMessageId: z.string().min(1).optional(),
  }),
  acceptedAt: z.number().int().nonnegative().optional(),
  queuedAt: z.number().int().nonnegative().optional(),
  startedAt: z.number().int().nonnegative().optional(),
  settledAt: z.number().int().nonnegative().optional(),
  failedAt: z.number().int().nonnegative().optional(),
  failureReason: z.string().optional(),
  /** Sender facts are retained; message bodies and history are not. */
  /** Optional host-proven turn/execution identity for settlement correlation. */
  turnId: z.string().min(1).optional(),
  executionId: z.string().min(1).optional(),
  dispatchId: z.string().min(1).optional(),
  inProgressReactionId: z.string().min(1).optional(),
  terminalFeedbackAt: z.number().int().nonnegative().optional(),
  terminalFeedbackError: z.string().optional(),
}).superRefine((delivery, issueCtx) => {
  const hasExecution = delivery.executionId !== undefined
  const hasTurn = delivery.turnId !== undefined
  if (delivery.status === 'accepted' && (hasExecution || hasTurn)) {
    issueCtx.addIssue({ code: 'custom', message: 'accepted Delivery cannot carry execution or turn proof' })
  }
  if (delivery.status === 'queued' && (!hasExecution || hasTurn || delivery.queuedAt === undefined)) {
    issueCtx.addIssue({ code: 'custom', message: 'queued Delivery requires execution proof and queuedAt, but no turn proof' })
  }
  if ((delivery.status === 'running' || delivery.status === 'settled' || delivery.status === 'failed') &&
      (!hasExecution || !hasTurn)) {
    issueCtx.addIssue({ code: 'custom', message: 'running/terminal Delivery requires execution and turn proof' })
  }
  const root = delivery.rootMessageId ?? delivery.replyTarget?.rootMessageId ?? delivery.feedbackTarget.rootMessageId
  if ((delivery.status === 'accepted' || delivery.status === 'queued') &&
      (delivery.startedAt !== undefined || delivery.settledAt !== undefined || delivery.failedAt !== undefined)) {
    issueCtx.addIssue({ code: 'custom', message: 'pre-turn Delivery cannot carry started or terminal timestamps' })
  }
  if ((delivery.status === 'settled' || delivery.status === 'failed') && delivery.settledAt === undefined && delivery.failedAt === undefined) {
    issueCtx.addIssue({ code: 'custom', message: 'terminal Delivery requires a terminal timestamp' })
  }
  if (delivery.queuedAt !== undefined && delivery.acceptedAt !== undefined && delivery.queuedAt < delivery.acceptedAt) {
    issueCtx.addIssue({ code: 'custom', message: 'queuedAt must not precede acceptedAt' })
  }
  if (delivery.startedAt !== undefined && delivery.queuedAt !== undefined && delivery.startedAt < delivery.queuedAt) {
    issueCtx.addIssue({ code: 'custom', message: 'startedAt must not precede queuedAt' })
  }
  const terminalAt = delivery.settledAt ?? delivery.failedAt
  if (terminalAt !== undefined && delivery.startedAt !== undefined && terminalAt < delivery.startedAt) {
    issueCtx.addIssue({ code: 'custom', message: 'terminal timestamp must not precede startedAt' })
  }
  if (delivery.rootMessageId !== undefined && delivery.replyTarget?.rootMessageId !== undefined &&
      delivery.rootMessageId !== delivery.replyTarget.rootMessageId) {
    issueCtx.addIssue({ code: 'custom', message: 'Delivery rootMessageId conflicts with replyTarget' })
  }
  if (delivery.rootMessageId !== undefined && delivery.feedbackTarget.rootMessageId !== undefined &&
      delivery.rootMessageId !== delivery.feedbackTarget.rootMessageId) {
    issueCtx.addIssue({ code: 'custom', message: 'Delivery rootMessageId conflicts with feedbackTarget' })
  }
  if (root !== undefined && delivery.replyTarget?.rootMessageId !== undefined && root !== delivery.replyTarget.rootMessageId) {
    issueCtx.addIssue({ code: 'custom', message: 'Delivery reply root is inconsistent' })
  }
  if (delivery.replyTarget !== undefined &&
      (delivery.replyTarget.chatId !== delivery.endpoint.chatId ||
       (delivery.replyTarget.threadId ?? undefined) !== (delivery.endpoint.threadId ?? undefined) ||
       delivery.replyTarget.messageId !== delivery.messageId)) {
    issueCtx.addIssue({ code: 'custom', message: 'Delivery replyTarget must derive from endpoint/message' })
  }
  if (delivery.feedbackTarget.chatId !== delivery.endpoint.chatId ||
      (delivery.feedbackTarget.threadId ?? undefined) !== (delivery.endpoint.threadId ?? undefined) ||
      delivery.feedbackTarget.messageId !== delivery.messageId) {
    issueCtx.addIssue({ code: 'custom', message: 'Delivery feedbackTarget must derive from endpoint/message' })
  }
})

/**
 * One source-switch notice an endpoint is still owed.
 *
 * Keyed by locus generation, because a later switch supersedes an earlier
 * one's debt rather than merging with it. While a row exists the generation
 * must not dispatch ordinary work: answering before the entry has been told
 * would present a different source as if nothing had changed.
 */
export const petLocusSwitchNotice = z.object({
  locusId: z.string().min(1),
  generation: z.number().int().positive(),
  endpoint: petLocusEndpoint,
  /** Rendered once at switch time so a retry cannot reword it. */
  text: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
})

/**
 * One append-only permission-grant record.
 *
 * The locus itself keeps only the CURRENT permission, which cannot answer
 * "who granted write, when, and was it ever actually in effect" after a later
 * downgrade overwrote it. Sharing a work root is exactly the decision that
 * needs an auditable trail, so each accepted change appends a row here.
 *
 * Append-only by contract: rows are never rewritten or deleted, and a
 * rebuilt/replaced generation gets its own rows rather than inheriting any.
 */
export const petLocusPermissionAudit = z.object({
  /** `<locusId>\u0000<generation>\u0000<sequence>`; stable and sortable. */
  id: z.string().min(1),
  locusId: z.string().min(1),
  generation: z.number().int().positive(),
  /** Monotonic per locus generation, so ordering never depends on the clock. */
  sequence: z.number().int().positive(),
  /** What the owner asked for. */
  desired: z.enum(['read', 'write']),
  /** What the Host actually verified; a refused escalation records `read`. */
  effective: z.enum(['read', 'write']),
  /** Host-derived operator; never taken from a browser body. */
  grantedBy: z.string().min(1),
  verifiedAt: z.number().int().nonnegative(),
  /** Present when the request was not granted as asked. */
  refusedReason: z.string().optional(),
})

/** A durable WAL/compensation record for multi-table locus operations. */
export const petLocusOperation = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'ensure',
    'ensure-default-qa',
    'replace',
    'rebuild',
    'busy',
    'stop',
    'retire',
    'invalidate',
    'permission',
    'anchor',
    'delivery',
  ]),
  phase: z.enum([
    'prepared',
    'provisioning',
    'publishing',
    'committed',
    'failed',
    'compensating',
    'compensated',
    'needs-recovery',
  ]),
  locusId: z.string().min(1).optional(),
  oldLocusId: z.string().min(1).optional(),
  newLocusId: z.string().min(1).optional(),
  /** Concrete mutation label retained in the WAL beside the broad kind. */
  operation: z.string().min(1).optional(),
  deliveryId: z.string().min(1).optional(),
  oldDeliveryId: z.string().min(1).optional(),
  newDeliveryId: z.string().min(1).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
  endpointKey: z.string().min(1).optional(),
  /** Stable hashes for idempotent begin/commit retries with the same id. */
  provisioningIntentHash: z.string().min(1).optional(),
  commitIntentHash: z.string().min(1).optional(),
  resourceRefs: z
    .object({
      chatId: z.string().min(1).optional(),
      threadId: z.string().min(1).optional(),
      parentSessionId: z.string().min(1).optional(),
      mainSessionId: z.string().min(1).optional(),
      childSessionId: z.string().min(1).optional(),
      workspaceId: z.string().min(1).optional(),
    })
    .optional(),
  step: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
})

const petGlobalState = z.object({
  /** Bumped whenever the enabled skill selection changes. */
  skillSetGeneration: z.number().int().nonnegative(),
  /** Monotonic epoch allocator per scope key. */
  scopeEpochs: z.record(z.string(), z.number().int().nonnegative()),
  // NOTE: `builtinsInitialized` used to live here, reserved for a first-boot
  // built-in Skill install that was never implemented and is now ruled out —
  // Pet ships no Skills of its own. Rows written with the key still load: zod
  // strips undeclared keys on read.
  /** Selected Pet executor provider/model; never contains credentials. */
  // Retained as optional so a database written by an older Pet still
  // validates. Nothing writes or reads them any more: Pet follows the Host's
  // default model selection rather than keeping its own copy.
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  agentPreset: z.string().optional(),
  /** Default context policy applied to new Tasks. */
  defaultContextPolicy: z.enum(['current-session', 'none']),
  // Mascot appearance configured in Settings. Persisted Host-side: anything
  // the Settings panel can change is configuration and belongs in the config
  // file. Position is deliberately absent — it is per-browser display state
  // set by dragging, not a setting, and stays in `localStorage`.
  appearance: z
    .object({
      accent: z.string().optional(),
      glyph: z.string().optional(),
      size: z.string().optional(),
      ringStyle: z.string().optional(),
    })
    .optional(),
  /** Registered Pet Workspace id, once created. */
  workspaceId: z.string().optional(),
})

/** The complete `dsh-pet` domain declaration. */
export const petDomainSpec = defineDomain({
  name: PET_DOMAIN_NAME,
  version: PET_DOMAIN_VERSION,
  global: {
    schema: petGlobalState,
    initial: {
      skillSetGeneration: 1,
      scopeEpochs: {},
      defaultContextPolicy: 'current-session' as const,
    },
  },
  tables: {
    tasks: domainTable<string, z.infer<typeof petTaskRecord>>(petTaskRecord),
    invocations: domainTable<string, z.infer<typeof petInvocationRecord>>(petInvocationRecord),
    snapshots: domainTable<string, z.infer<typeof petSourceSnapshot>>(petSourceSnapshot),
    runs: domainTable<string, z.infer<typeof petRunRecord>>(petRunRecord),
    skill_revisions: domainTable<string, z.infer<typeof petSkillRevision>>(petSkillRevision),
    skill_selections: domainTable<string, z.infer<typeof petSkillSelection>>(petSkillSelection),
    workspace_env: domainTable<string, z.infer<typeof petEnvEntry>>(petEnvEntry),
    channel_config: domainTable<string, z.infer<typeof petChannelConfig>>(petChannelConfig),
    chat_bindings: domainTable<string, z.infer<typeof petChatBinding>>(petChatBinding),
    invocation_channel:
      domainTable<string, z.infer<typeof petInvocationChannel>>(petInvocationChannel),
    // Unified locus storage is deliberately additive. The legacy channel tables
    // above remain declared so existing rows can be opened and preserved; the
    // locus adapter below never reads or mutates them.
    loci: domainTable<string, z.infer<typeof petLocusRecord>>(petLocusRecord),
    locus_indexes: domainTable<string, z.infer<typeof petLocusIndex>>(petLocusIndex),
    locus_deliveries: domainTable<string, z.infer<typeof petLocusDelivery>>(petLocusDelivery),
    locus_operations: domainTable<string, z.infer<typeof petLocusOperation>>(petLocusOperation),
    locus_switch_notices: domainTable<string, z.infer<typeof petLocusSwitchNotice>>(petLocusSwitchNotice),
    locus_permission_audit: domainTable<string, z.infer<typeof petLocusPermissionAudit>>(petLocusPermissionAudit),
  },
})

/** Pet global configuration state as stored. */
export type PetGlobalState = z.infer<typeof petGlobalState>

/** One stored environment entry. */
export type PetEnvEntry = z.infer<typeof petEnvEntry>

/** Lark channel configuration as stored. */
export type PetChannelConfig = z.infer<typeof petChannelConfig>

/** One chat's route and active Task pointer. */
export type PetChatBinding = z.infer<typeof petChatBinding>

/** Trusted reply target for one channel-triggered Invocation. */
export type PetInvocationChannel = z.infer<typeof petInvocationChannel>

/** Unified locus records and persistence payloads. */
export type PetLocusEndpoint = z.infer<typeof petLocusEndpoint>
export type PetLocusPermission = z.infer<typeof petLocusPermission>
export type PetLocusRecord = z.infer<typeof petLocusRecord>
export type PetLocusIndex = z.infer<typeof petLocusIndex>
export type PetLocusDelivery = z.infer<typeof petLocusDelivery>
export type PetLocusOperation = z.infer<typeof petLocusOperation>
export type PetLocusSwitchNotice = z.infer<typeof petLocusSwitchNotice>
export type PetLocusPermissionAudit = z.infer<typeof petLocusPermissionAudit>


/**
 * Composite key for a skill revision row: one skill name may hold several
 * immutable revisions simultaneously while any is still referenced.
 * @param skillName - Kebab-case skill name.
 * @returns the stable table key.
 */
export function revisionKey(skillName: string): string {
  return skillName
}

/**
 * Composite key for one environment entry.
 *
 * Scope first so a scope's entries sort together. A workspace id never equals
 * {@link PET_ENV_GLOBAL_SCOPE}, and a validated key contains no `\u0000`, so
 * this separator cannot produce a collision between two distinct pairs.
 * @param scope - `global` or a workspace id.
 * @param key - Validated upper-snake-case variable name.
 * @returns the stable table key.
 */
export function envKey(scope: string, key: string): string {
  return `${scope}\u0000${key}`
}
