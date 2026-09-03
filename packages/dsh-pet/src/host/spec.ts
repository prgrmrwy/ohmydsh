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
export const PET_DOMAIN_VERSION = 3

const petSourceKind = z.enum(['session', 'workspace', 'none'])

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
  skillName: z.string().min(1),
  skillSourcePath: z.string().min(1),
  skillSetGeneration: z.number().int().nonnegative(),
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
  },
})

/** Pet global configuration state as stored. */
export type PetGlobalState = z.infer<typeof petGlobalState>

/** One stored environment entry. */
export type PetEnvEntry = z.infer<typeof petEnvEntry>


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
