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
export const PET_DOMAIN_VERSION = 1

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
  skillDigest: z.string().min(1),
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

const petSkillRevision = z.object({
  skillName: z.string().min(1),
  digest: z.string().min(1),
  description: z.string(),
  // Pet presentation and context requirement, declared by the SKILL.md
  // frontmatter. Persisted with the immutable revision so the menu stays
  // stable for queued work even if a newer revision changes them.
  pet: z
    .object({
      label: z.string().optional(),
      icon: z.string().optional(),
      context: z.enum(['none', 'optional', 'workspace-required', 'session-required']).optional(),
      confirm: z.boolean().optional(),
    })
    .optional(),
  provenance: z.object({
    kind: z.enum(['builtin', 'local-import']),
    sourcePath: z.string().optional(),
    packageVersion: z.string().optional(),
    installedAt: z.number().int(),
  }),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
})

const petSkillSelection = z.object({
  skillName: z.string().min(1),
  enabledDigest: z.string().optional(),
  showAsShortcut: z.boolean(),
  upgradeAvailableDigest: z.string().optional(),
})

const petWorkspaceBinding = z.object({
  workspaceId: z.string().min(1),
  business: z.string().optional(),
  crGroupId: z.string().optional(),
  reviewers: z.array(z.string()).optional(),
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
  /** Whether first-boot built-in installation already ran. */
  builtinsInitialized: z.boolean(),
  /** Selected Pet executor provider/model; never contains credentials. */
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  agentPreset: z.string().optional(),
  /** Default context policy applied to new Tasks. */
  defaultContextPolicy: z.enum(['current-session', 'none']),
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
      builtinsInitialized: false,
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
    workspace_bindings: domainTable<string, z.infer<typeof petWorkspaceBinding>>(petWorkspaceBinding),
  },
})

/** Pet global configuration state as stored. */
export type PetGlobalState = z.infer<typeof petGlobalState>

/** Durable workspace binding for bounded side effects. */
export type PetWorkspaceBinding = z.infer<typeof petWorkspaceBinding>

/**
 * Composite key for a skill revision row: one skill name may hold several
 * immutable revisions simultaneously while any is still referenced.
 * @param skillName - Kebab-case skill name.
 * @param digest - Content digest of the revision.
 * @returns the stable table key.
 */
export function revisionKey(skillName: string, digest: string): string {
  return `${skillName}@${digest}`
}
