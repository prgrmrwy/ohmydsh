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
export const PET_DOMAIN_VERSION = 4

// `chat` joins the original three for Tasks created by an inbound Lark
// message. It is a distinct scope kind rather than a flavour of `workspace`
// on purpose: two chats routed to the same workspace must NOT share a Task,
// and the spec requires chat scopes to be independent.
const petSourceKind = z.enum(['session', 'workspace', 'none', 'chat'])

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
 */
const petChatBinding = z.object({
  chatId: z.string().regex(PET_CHAT_ID_PATTERN),
  chatType: z.enum(['p2p', 'group']),
  /** Route target. Always a workspace id, never a raw path. */
  workspaceId: z.string().min(1),
  /**
   * Task currently serving this chat, when one exists.
   *
   * A POINTER, not ownership: it may go stale (archived, deleted). Consumers
   * re-verify the Task and heal the pointer rather than trusting it.
   */
  activeTaskId: z.string().min(1).optional(),
  /** Human-readable chat name, cached for the settings list only. */
  chatName: z.string().optional(),
  boundBy: z.enum(['auto', 'user']),
  boundAt: z.number().int(),
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
