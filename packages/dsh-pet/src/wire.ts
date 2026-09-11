/**
 * Shared DSH Pet wire contract between the Host half and the Web client half.
 *
 * This module MUST stay free of runtime imports: it is compiled into the Node
 * Host bundle and into the browser client bundle alike, so it may only declare
 * types, constants and pure helpers.
 */

/** Stable plugin identity, used for the state directory and the client bundle id. */
export const PET_PLUGIN_ID = 'dsh-pet'

/** Display title of the Pet-owned Workspace registered in DSH. */
export const PET_WORKSPACE_TITLE = 'DSH Pet'

/** Exact Host routes. Every mutation is same-origin/loopback constrained by DSH Web transport. */
/**
 * Preset composing a Pet executor WITHOUT local-root Skill discovery.
 *
 * Shared because both halves need it: the Host defaults new executors to it,
 * and Settings shows it as the current selection when none is stored.
 * `standard` would load `skill-filesystem` and make every globally installed
 * Skill visible to the executor — see ADR-0001.
 */
export const PET_EXECUTOR_PRESET = 'dsh-pet-executor'

/**
 * DSH's ordinary full coding-agent preset.
 *
 * Named explicitly for workspace-resident executors rather than left unset:
 * an omitted preset is not recorded on the session header at all, so the UI
 * has nothing to show and the session appears to have no mode. Saying
 * `standard` states the intent and keeps it visible.
 */
export const STANDARD_PRESET = 'standard'

export const ROUTES = {
  status: '/dsh-pet/api/status',
  config: '/dsh-pet/api/config',
  configUpdate: '/dsh-pet/api/config-update',
  capabilities: '/dsh-pet/api/capabilities',
  presets: '/dsh-pet/api/presets',
  skills: '/dsh-pet/api/skills',
  skillInspect: '/dsh-pet/api/skill-inspect',
  skillImport: '/dsh-pet/api/skill-import',
  skillMutate: '/dsh-pet/api/skill-mutate',
  projectionRebuild: '/dsh-pet/api/projection-rebuild',
  workspaceRepair: '/dsh-pet/api/workspace-repair',
  tasks: '/dsh-pet/api/tasks',
  taskDetail: '/dsh-pet/api/task-detail',
  invocationCreate: '/dsh-pet/api/invocation-create',
  invocationAnswer: '/dsh-pet/api/invocation-answer',
  invocationCancel: '/dsh-pet/api/invocation-cancel',
  invocationRetry: '/dsh-pet/api/invocation-retry',
  taskArchive: '/dsh-pet/api/task-archive',
  diagnostics: '/dsh-pet/api/diagnostics',
  petEnv: '/dsh-pet/api/env',
  petEnvMutate: '/dsh-pet/api/env-mutate',
  channel: '/dsh-pet/api/channel',
  channelMutate: '/dsh-pet/api/channel-mutate',
  channelBind: '/dsh-pet/api/channel-bind',
} as const

/**
 * Routes for the unified locus management surface.
 *
 * These paths intentionally live beside, rather than inside, the legacy
 * `ROUTES` object.  The legacy object is the currently registered Host
 * surface; adding a not-yet-cut-over route there would make old clients and
 * route-registration checks treat an unimplemented endpoint as live.  The
 * separate object lets Host and Web share the next protocol while ordinary
 * Task/Invocation routes remain unchanged until channel cutover.
 */
export const LOCUS_ROUTES = {
  /** Complete owner-facing locus management snapshot. */
  view: '/dsh-pet/api/locus',
  /** Endpoint/parent/child reverse-discovery projection. */
  discovery: '/dsh-pet/api/locus-discovery',
  /** One mutation endpoint accepting the discriminated action request below. */
  action: '/dsh-pet/api/locus-action',
  /** Explicit default-Q&A create/open operation. */
  defaultQa: '/dsh-pet/api/locus-default-qa',
  /** Optional per-action endpoints for a staged Host cutover. */
  bind: '/dsh-pet/api/locus-bind',
  unbind: '/dsh-pet/api/locus-unbind',
  /** Archive/retire a locus while preserving its history and resources. */
  archive: '/dsh-pet/api/locus-archive',
  /** Stop a locus while retaining its endpoint stop marker. */
  stop: '/dsh-pet/api/locus-stop',
  scope: '/dsh-pet/api/locus-scope',
  rebuild: '/dsh-pet/api/locus-rebuild',
} as const

/** Alias for callers that name the object after the management surface. */
export const LOCUS_MANAGEMENT_ROUTES = LOCUS_ROUTES

export type PetLocusRoute = (typeof LOCUS_ROUTES)[keyof typeof LOCUS_ROUTES]

// ---------------------------------------------------------------------------
// Unified locus management wire contract
// ---------------------------------------------------------------------------

/**
 * A Feishu collaboration endpoint.  `messageId` deliberately does not belong
 * here: it identifies one delivery, not the durable chat/topic address.
 */
export interface PetLocusEndpointView {
  readonly chatId: string
  readonly threadId?: string
  /** Platform display facts; Host revalidates them and never uses them as authority. */
  readonly chatType?: 'p2p' | 'group'
  readonly chatName?: string
}

/** Endpoint fields accepted as a bind/rebuild intent (display facts excluded). */
export type PetLocusEndpointInput = Pick<PetLocusEndpointView, 'chatId' | 'threadId'>

/** Alias used by Host adapters that refer to this as an endpoint value. */
export type PetLocusEndpoint = PetLocusEndpointView

/** Where a locus generation obtained its main-session association. */
export type PetLocusSource = 'auto' | 'inherited' | 'explicit' | 'qa-created'

/** Durable lifecycle of one locus generation. */
export type PetLocusState =
  | 'provisioning'
  | 'active'
  | 'switching'
  | 'invalid'
  | 'stopped'
  | 'retired'

/** Main/parent session facts shown by the management surface. */
export interface PetLocusMainSessionView {
  readonly sessionId: string
  readonly title?: string
  readonly source?: PetLocusSource
  readonly availability?: 'available' | 'archived' | 'missing'
}

/** Dedicated child session facts; provisioning generations may not have one. */
export interface PetLocusChildSessionView {
  readonly sessionId?: string
  readonly title?: string
  readonly availability?: 'available' | 'archived' | 'missing'
}

/** Workspace ownership derived from the main session. */
export interface PetLocusWorkspaceView {
  readonly workspaceId: string
  readonly title?: string
  /** Display-only path; omitted when the Host cannot resolve one safely. */
  readonly path?: string
  /** Confirmed execution-root anchor, not a sandbox authorization claim. */
  readonly executionRoot?: string
}

/** Caller-bound execution-root facts; never infer authorization from its presence. */
export interface PetLocusContextAnchorView {
  readonly status: 'confirmed' | 'missing' | 'unknown'
  readonly existence?: 'exists' | 'missing' | 'unknown'
  readonly authorization?: 'authorized' | 'unauthorized' | 'unknown'
  readonly executionRoot?: string
  readonly projectResources?: readonly string[]
  readonly constraints?: readonly string[]
  readonly provenance?: string
  readonly confirmedAt?: number
}

export type PetLocusPermissionMode = 'read' | 'write'

/** Desired and Host-verified effective permission for one locus generation. */
export interface PetLocusPermissionView {
  readonly desired: PetLocusPermissionMode
  readonly effective: PetLocusPermissionMode
  readonly verifiedAt?: number
  readonly grantedBy?: string
}

/** State metadata kept separate from the permission axes. */
export interface PetLocusStateView {
  readonly state: PetLocusState
  /** Accepted/running work fences source switching and scope changes. */
  readonly busy: boolean
  readonly invalidReason?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly stoppedAt?: number
  readonly retiredAt?: number
}

/** Generation identity and replacement provenance for one locus view. */
export interface PetLocusGenerationView {
  readonly locusId: string
  readonly generation: number
  readonly replacesLocusId?: string
}

/**
 * Complete owner-facing projection of one locus generation.
 *
 * The nested objects intentionally mirror the domain aggregate's endpoint,
 * parent/child session, workspace, permission and state concepts.  This is a
 * projection, not a second persistence schema: Task/Invocation records remain
 * the ordinary Pet API and are not embedded or renamed here.
 */
export interface PetLocusView {
  readonly locusId: string
  readonly generation: number
  readonly endpoint: PetLocusEndpointView
  readonly main: PetLocusMainSessionView
  readonly child: PetLocusChildSessionView
  readonly workspace: PetLocusWorkspaceView
  readonly contextAnchor?: PetLocusContextAnchorView
  readonly permission: PetLocusPermissionView
  readonly state: PetLocusStateView
  readonly source: PetLocusSource
  /** Chat-level locus that structurally owns this topic, when applicable. */
  readonly parentLocusId?: string
  /** Derived from the parent-session default-Q&A index. */
  readonly isDefaultQa: boolean
  /** Compatibility spelling retained for early staged consumers. */
  readonly defaultQa?: boolean
}

/** Stable endpoint-index projection: current generation plus immutable history. */
export interface PetLocusEndpointDiscoveryView {
  readonly endpoint: PetLocusEndpointView
  readonly current?: PetLocusView
  readonly history: readonly PetLocusView[]
}

/** Parent-session reverse index, including the independent default-Q&A pointer. */
export interface PetLocusParentDiscoveryView {
  readonly parentSessionId: string
  readonly defaultQa?: PetLocusView
  readonly loci: readonly PetLocusView[]
}

/** Child-session reverse lookup.  It never enumerates sibling loci. */
export interface PetLocusChildDiscoveryView {
  readonly childSessionId: string
  /** Current reverse-index match; absent when the child has no active locus. */
  readonly locus?: PetLocusView
  /** Historical matches are owner-visible and may be empty. */
  readonly history?: readonly PetLocusView[]
}

/**
 * Bidirectional discovery projection used by the owner-facing management view.
 * Individual branches may be omitted when a query was scoped to another index.
 */
export interface PetLocusDiscoveryView {
  readonly byEndpoint: readonly PetLocusEndpointDiscoveryView[]
  readonly byParent: readonly PetLocusParentDiscoveryView[]
  readonly byChild: readonly PetLocusChildDiscoveryView[]
}

/** A scoped discovery result keeps the owner snapshot shape unambiguous. */
export interface PetLocusDiscoveryResult {
  readonly discovery: PetLocusDiscoveryView
}

/** Independent default-Q&A pointer for one main session. */
export interface PetLocusDefaultQaView {
  readonly parentSessionId: string
  readonly locus?: PetLocusView
}

/** Complete locus management snapshot returned by the new view route. */
export interface PetLocusManagementView {
  /** Monotonic snapshot generation, separate from each locus's generation. */
  readonly generation: number
  readonly loci: readonly PetLocusView[]
  readonly defaultQa: readonly PetLocusDefaultQaView[]
  readonly discovery: PetLocusDiscoveryView
}

/**
 * Storage-aligned locus projection for Host adapters and persistence tooling.
 *
 * Unlike `PetLocusView`, this shape keeps the aggregate's stable field names
 * verbatim (`id`, `parentSessionId`, `childSessionId`, `workspaceId`, scalar
 * `state`, etc.). It is additive so a staged client can use the richer nested
 * view without forcing a legacy adapter to rename its records.
 */
export interface PetLocusRecordView {
  readonly id: string
  readonly generation: number
  readonly endpoint: PetLocusEndpointView
  readonly parentSessionId: string
  readonly childSessionId?: string
  readonly workspaceId: string
  readonly parentLocusId?: string
  readonly source: PetLocusSource
  readonly state: PetLocusState
  readonly permission: PetLocusPermissionView
  readonly busy: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly retiredAt?: number
  readonly stoppedAt?: number
  readonly invalidReason?: string
  readonly replacesLocusId?: string
  /** Optional optimistic fence supported by the durable locus schema. */
  readonly revision?: number
  /** Confirmed caller-bound anchor; presence never implies write permission. */
  readonly contextAnchor?: {
    readonly status: 'confirmed' | 'missing' | 'unknown'
    readonly existence?: 'exists' | 'missing' | 'unknown'
    readonly authorization?: 'authorized' | 'unauthorized' | 'unknown'
    readonly executionRoot?: string
    readonly projectResources?: readonly string[]
    readonly constraints?: readonly string[]
    readonly provenance?: string
    readonly confirmedAt?: number
  }
}

/** Query selectors for the discovery route; at least one selector is expected. */
export interface PetLocusDiscoveryRequest {
  readonly endpoint?: PetLocusEndpointInput
  readonly parentSessionId?: string
  readonly childSessionId?: string
}

/** Browser-safe body for creating/opening a main session's stable default Q&A locus. */
export interface PetLocusDefaultQaRequest {
  readonly parentSessionId: string
  /** The Host derives the authenticated actor; browser bodies must not send one. */
  readonly groupName?: string
}

/** Internal Host request after the authenticated actor has been attached. */
export interface PetLocusDefaultQaHostRequest extends PetLocusDefaultQaRequest {
  readonly actorId: string
}

/** Explicit default-Q&A route result. */
export interface PetLocusDefaultQaResult {
  readonly action: 'default-qa'
  readonly locus: PetLocusView
  readonly created?: boolean
  readonly reused?: boolean
}

/** Optional optimistic-concurrency fence shared by locus mutations. */
export interface PetLocusMutationFence {
  /** Endpoint generation observed by the caller. */
  readonly expectedGeneration?: number
  /** Current locus id observed by the caller, for replacement/retire races. */
  readonly expectedLocusId?: string
  /** Last update timestamp observed by the caller. */
  readonly expectedUpdatedAt?: number
}

/** Bind an endpoint to a main session, creating a fresh read child. */
export interface PetLocusBindAction extends PetLocusMutationFence {
  readonly action: 'bind'
  readonly endpoint: PetLocusEndpointInput
  readonly parentSessionId: string
  /** Workspace is normally derived from the parent and is revalidated Host-side. */
  readonly workspaceId?: string
  readonly parentLocusId?: string
}

/** Stop the exact current endpoint association while retaining its history. */
export interface PetLocusUnbindAction extends PetLocusMutationFence {
  readonly action: 'unbind'
  readonly locusId: string
  /** Required so Host can prove this id is still the endpoint's current generation. */
  readonly endpoint: PetLocusEndpointInput
}

/** Archive the exact current entry while preserving an anti-revival stop marker. */
export interface PetLocusArchiveAction extends PetLocusMutationFence {
  readonly action: 'archive'
  readonly locusId: string
  /** Required so a stale panel row cannot archive a replacement generation. */
  readonly endpoint: PetLocusEndpointInput
}

/** Stop the exact current locus while keeping the durable endpoint stop marker. */
export interface PetLocusStopAction extends PetLocusMutationFence {
  readonly action: 'stop'
  readonly locusId: string
  readonly endpoint: PetLocusEndpointInput
}

/** Change the shared read/write permission of the current locus. */
export interface PetLocusScopeAction extends PetLocusMutationFence {
  readonly action: 'scope'
  readonly locusId: string
  readonly mode: PetLocusPermissionMode
  /**
   * The Host derives the audit actor from the authenticated request. This
   * action intentionally carries no client-supplied identity field.
   */
}

/** Explicit owner confirmation of context facts for the exact current locus. */
export interface PetLocusConfirmAnchorAction extends PetLocusMutationFence {
  readonly action: 'confirm-anchor'
  readonly locusId: string
  readonly endpoint: PetLocusEndpointInput
  readonly executionRoot?: string
  readonly projectResources?: readonly string[]
  readonly constraints?: readonly string[]
  /** Owner observation only; never authorizes the path or changes scope. */
  readonly existence?: 'exists' | 'missing' | 'unknown'
}

/** Explicitly rebuild a stopped/invalid endpoint as a new read generation. */
export interface PetLocusRebuildAction extends PetLocusMutationFence {
  readonly action: 'rebuild'
  readonly endpoint: PetLocusEndpointInput
  readonly parentSessionId: string
  readonly workspaceId?: string
  readonly parentLocusId?: string
  /** Rebuilt endpoint may claim the parent's default-Q&A slot only explicitly. */
  readonly asDefaultQa?: boolean
}

/** Discriminated mutation request accepted by the staged locus action route. */
export type PetLocusActionRequest =
  | PetLocusBindAction
  | PetLocusUnbindAction
  | PetLocusArchiveAction
  | PetLocusStopAction
  | PetLocusScopeAction
  | PetLocusConfirmAnchorAction
  | PetLocusRebuildAction

/** Result shared by all explicit locus actions. */
export interface PetLocusActionResult {
  readonly action: PetLocusActionRequest['action']
  readonly locus: PetLocusView
  readonly previousLocus?: PetLocusView
  readonly created?: boolean
  readonly reused?: boolean
  readonly warningText?: string
}

/** Dedicated route response for an explicit bind operation. */
export interface PetLocusBindResult extends PetLocusActionResult {
  readonly action: 'bind'
}

/** Dedicated route response for an explicit unbind operation. */
export interface PetLocusUnbindResult extends PetLocusActionResult {
  readonly action: 'unbind'
}

/** Dedicated route response for a scope operation. */
export interface PetLocusScopeResult extends PetLocusActionResult {
  readonly action: 'scope'
}

/** Dedicated route response for a rebuild operation. */
export interface PetLocusRebuildResult extends PetLocusActionResult {
  readonly action: 'rebuild'
}

/** Dedicated route response for archive/retire. */
export interface PetLocusArchiveResult extends PetLocusActionResult {
  readonly action: 'archive'
}

/** Dedicated route response for stop. */
export interface PetLocusStopResult extends PetLocusActionResult {
  readonly action: 'stop'
}

/** Compatibility aliases for integrations that omit the `Pet` prefix. */
export type PetLocusBindRequest = PetLocusBindAction
export type PetLocusUnbindRequest = PetLocusUnbindAction
export type PetLocusScopeRequest = PetLocusScopeAction
export type PetLocusRebuildRequest = PetLocusRebuildAction
export type PetLocusArchiveRequest = PetLocusArchiveAction
export type PetLocusStopRequest = PetLocusStopAction
export type LocusEndpointView = PetLocusEndpointView
export type LocusMainSessionView = PetLocusMainSessionView
export type LocusChildSessionView = PetLocusChildSessionView
export type LocusWorkspaceView = PetLocusWorkspaceView
export type LocusPermissionView = PetLocusPermissionView
export type LocusStateView = PetLocusStateView
export type LocusGenerationView = PetLocusGenerationView
export type LocusView = PetLocusView
export type LocusDiscoveryView = PetLocusDiscoveryView
export type LocusManagementView = PetLocusManagementView
export type LocusActionRequest = PetLocusActionRequest
export type LocusRecordView = PetLocusRecordView

/**
 * Stable scalar route constants for integrations that import one path rather
 * than the complete route map.
 */
export const LOCUS_VIEW_ROUTE = LOCUS_ROUTES.view
export const LOCUS_DISCOVERY_ROUTE = LOCUS_ROUTES.discovery
export const LOCUS_ACTION_ROUTE = LOCUS_ROUTES.action
export const LOCUS_DEFAULT_QA_ROUTE = LOCUS_ROUTES.defaultQa
export const LOCUS_BIND_ROUTE = LOCUS_ROUTES.bind
export const LOCUS_UNBIND_ROUTE = LOCUS_ROUTES.unbind
export const LOCUS_ARCHIVE_ROUTE = LOCUS_ROUTES.archive
export const LOCUS_STOP_ROUTE = LOCUS_ROUTES.stop
export const LOCUS_SCOPE_ROUTE = LOCUS_ROUTES.scope
export const LOCUS_REBUILD_ROUTE = LOCUS_ROUTES.rebuild

/**
 * Wheel id of the built-in Q&A action.
 *
 * A `builtin` capability id, deliberately not a Skill name: nothing may
 * resolve a Skill from it.
 */
export const QA_GROUP_ACTION_ID = 'qa-group'

/** What the Q&A action returns once its group exists. */
export interface PetQaGroupResult {
  readonly chatId: string
  readonly chatName: string
  readonly childSessionId: string
  readonly taskId: string
  /**
   * Whether an existing group was returned instead of a new one created.
   *
   * One source session owns at most one live QA group, so a second click is
   * "show me my group". The client must be able to say which happened: two
   * identical-looking outcomes are how several identically named groups came
   * to exist before reuse was implemented.
   */
  readonly reused?: boolean
}

/**
 * Reserved scope naming the global environment set.
 *
 * Shared by both halves: the client sends it verbatim as `scope`, and the Host
 * stores it in the same column workspace ids use. A DSH workspace id is
 * generated and never this literal, so the two cannot be confused.
 */
export const PET_ENV_GLOBAL = 'global'

/** One configured environment entry, as the management routes exchange it. */
export interface PetEnvRecord {
  /** `global`, or a workspace id. */
  readonly scope: string
  /** Upper-snake-case name, stored WITHOUT the `DSH_PET_` prefix. */
  readonly key: string
  readonly value: string
  readonly updatedAt: number
}

/** A workspace the environment tab can target, for the picker. */
export interface PetWorkspaceChoice {
  readonly id: string
  readonly title?: string
  readonly path?: string
}

// ---------------------------------------------------------------------------
// Lark channel
// ---------------------------------------------------------------------------

/**
 * Bound bot identity, as the management routes expose it.
 *
 * Identity facts only. There is deliberately no field for an app secret: the
 * secret lives in lark-cli, and a shape that could carry one would eventually
 * be filled in.
 */
export interface PetBotIdentity {
  readonly appId: string
  readonly name?: string
  /** Absent until the supported lark-cli proves the bot identity. */
  readonly openId?: string
}

/** Progress of a bot-binding flow. */
export type PetBindPhase = 'idle' | 'awaiting-authorization' | 'bound' | 'failed'

/** Bot-binding flow state, safe to show in the UI. */
export interface PetBindState {
  readonly phase: PetBindPhase
  /** One-time onboarding link; not a credential. */
  readonly verificationUrl?: string
  readonly appId?: string
  readonly diagnostic?: string
}

/** Live connection state of the inbound subscription. */
export type PetChannelPhase = 'stopped' | 'starting' | 'connected' | 'reconnecting' | 'down'

/**
 * Ephemeral allowlist pairing state safe to expose to authenticated Settings.
 *
 * Only `waiting` carries the one-time command. Terminal states deliberately do
 * not: once a code has been claimed or failed it must no longer be reusable or
 * recoverable from a later management response.
 */
export type PetPairingState =
  | { readonly phase: 'starting' }
  | { readonly phase: 'waiting'; readonly command: string; readonly expiresAt: number }
  | { readonly phase: 'claiming'; readonly expiresAt: number }
  | { readonly phase: 'succeeded'; readonly openId: string; readonly name?: string }
  | { readonly phase: 'expired' }
  | { readonly phase: 'failed'; readonly diagnostic: string }

/** One chat route, as the management routes exchange it. */
export interface PetChatRoute {
  readonly chatId: string
  readonly chatType: 'p2p' | 'group'
  readonly chatName?: string
  /** Binding kind; `workspace` routes to a workspace, `qa` to a fork child. */
  readonly kind: 'workspace' | 'qa'
  /** Present on `workspace` bindings only. */
  readonly workspaceId?: string
  readonly activeTaskId?: string
  /**
   * Executor session of the active Task, when one exists.
   *
   * Projected alongside `activeTaskId` because a task id alone cannot be
   * navigated to: the settings page offers "open the session" and needs the
   * session id the shell actually routes on.
   */
  readonly activeExecutorSessionId?: string
  /**
   * Whether the session this route would open has been archived.
   *
   * The shell silently navigates to the home page when asked to open an
   * archived session, so the settings page needs to know BEFORE offering the
   * control: a button that looks live and quietly does the wrong thing is
   * worse than a disabled one that says why.
   */
  readonly sessionArchived?: boolean
  /** Present on `qa` bindings: the fork child serving the group. */
  readonly qaChildSessionId?: string
  /** Present on `qa` bindings: the source session the child was forked from. */
  readonly qaParentSessionId?: string
  /**
   * How a `qa` binding came to exist: Pet created the group, or an existing
   * group was attached with `/bind`. Presentational only — it exists so the
   * UI can avoid implying Pet can manage a group it merely joined.
   */
  readonly qaOrigin?: 'created' | 'bound'
  /** Present when a qa binding has been invalidated (no longer raises work). */
  readonly qaInvalidatedAt?: number
  readonly qaInvalidatedReason?: string
  readonly boundBy: 'auto' | 'user'
  readonly boundAt: number
}

/**
 * How the settings page groups chat routes.
 *
 * `kind` and `chatType` are independent axes — a workspace binding may be a
 * group or a p2p conversation — so neither alone yields a set of tabs that
 * partitions the list. QA groups are split off first because they are a
 * different routing target entirely (a fork child, not a workspace), and the
 * remainder divides by conversation shape.
 */
export type PetRouteGroup = 'qa' | 'workspace' | 'direct'

/**
 * Classify a route into exactly one settings group.
 * @param route - The route to classify.
 * @returns its group; the three groups are mutually exclusive and total.
 */
export function routeGroupOf(
  route: Pick<PetChatRoute, 'kind' | 'chatType'>,
): PetRouteGroup {
  if (route.kind === 'qa') return 'qa'
  return route.chatType === 'p2p' ? 'direct' : 'workspace'
}

/**
 * Lark AppLink that opens a conversation in the Lark client.
 *
 * A generic AppLink rather than a share link from `im chats link`: it needs no
 * request, no permission on the chat and no validity period, and it works for
 * a p2p conversation — which the share-link API explicitly refuses ("单聊、
 * 密聊、团队群不支持分享群链接"). Pet only ever holds an `oc_…` id, which is
 * exactly what this protocol takes.
 * @param chatId - The `oc_…` chat id.
 * @returns the AppLink, or `undefined` when the id is not usable.
 */
export function chatAppLink(chatId: string): string | undefined {
  const trimmed = chatId.trim()
  // Guard the shape rather than trusting the caller: a blank or non-chat id
  // would otherwise produce a link that silently opens nothing.
  if (!trimmed.startsWith('oc_')) return undefined
  return `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(trimmed)}`
}

/** Host proof that new Feishu work can use the unified child-session path safely. */
export interface PetUnifiedLocusReadiness {
  /** Child creation/resume, caller-bound context and per-turn correlation were all proved. */
  readonly childSession: 'verified' | 'unavailable'
  /** Every newly published locus starts at the one permitted default. */
  readonly defaultPermission: 'read'
  /** The Host applied and read back the effective read policy. */
  readonly readVerification: 'verified' | 'unavailable'
  /** Stable operator-facing reason when either proof is unavailable. */
  readonly diagnostic?: string
}

/** Stable onboarding blocker understood by both Host and settings UI. */
export type PetChannelBlockerCode =
  | 'bot-unbound'
  | 'bot-identity-unresolved'
  | 'allowlist-empty'
  | 'default-workspace-missing'
  | 'default-workspace-unavailable'
  | 'unified-locus-unavailable'
  | 'profile-unavailable'
  | 'permission-missing'

export interface PetChannelBlocker {
  readonly code: PetChannelBlockerCode
  readonly message: string
  readonly missingScopes?: readonly string[]
  readonly consoleUrl?: string
}

/** Everything the Channel settings tab renders. */
export interface PetChannelView {
  readonly enabled: boolean
  /** Absent until a bot is bound. */
  readonly bot?: PetBotIdentity
  readonly allowOpenIds: readonly string[]
  /**
   * Display names for known open_ids, for presentation only.
   *
   * Admission compares ids; this exists so the list is readable.
   */
  readonly knownNames: Readonly<Record<string, string>>
  /** Current Host-owned allowlist pairing, absent after restart or cancel. */
  readonly pairing?: PetPairingState
  readonly defaultWorkspaceId?: string
  /**
   * Legacy route projection kept on the wire while the Host cutover removes its
   * old persistence. New clients MUST NOT render or mutate this list.
   */
  readonly routes: readonly PetChatRoute[]
  /** Unified child-session/read-policy proof used by channel onboarding. */
  readonly unifiedLocus: PetUnifiedLocusReadiness
  /** Ordered readiness checks; the first blocker is the next action. */
  readonly onboarding: {
    readonly ready: boolean
    readonly steps: readonly {
      readonly id: 'bot' | 'identity' | 'allowlist' | 'workspace' | 'locus' | 'subscription'
      readonly label: string
      readonly complete: boolean
    }[]
    readonly blockers: readonly PetChannelBlocker[]
  }
  readonly connection: {
    readonly phase: PetChannelPhase
    readonly diagnostic?: string
    /** Invocations waiting behind current work, across all chats. */
    readonly queueDepth: number
  }
  /** Present while a binding flow is running or has just failed. */
  readonly binding?: PetBindState
}

/** Maximum accepted JSON request body for any Pet management route. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024

// ---------------------------------------------------------------------------
// Host lifecycle
// ---------------------------------------------------------------------------

/**
 * Contained Pet Host lifecycle. A Pet that cannot initialize becomes
 * `degraded` and MUST NOT prevent ordinary DSH services from loading.
 */
export type PetLifecycle = 'starting' | 'ready' | 'degraded' | 'stopping'

export interface PetLifecycleState {
  readonly phase: PetLifecycle
  /** Human-readable diagnostic present whenever `phase` is `degraded`. */
  readonly diagnostic?: string
  /** Monotonic counter so the client can detect a restart without polling. */
  readonly generation: number
}

// ---------------------------------------------------------------------------
// Source scope
// ---------------------------------------------------------------------------

/**
 * The supported Pet Task source kinds.
 *
 * `chat` is an external channel conversation (a Lark chat). It is a source
 * kind of its own rather than a flavour of `workspace`: two chats routed to
 * the same workspace MUST keep independent Tasks, which only holds when the
 * chat id — not the route target — is what forms the scope key.
 *
 * `qa-chat` is a QA group, whose Task represents a fork child of a user
 * session rather than an executor Pet created. Distinct from `chat` because
 * the healing paths differ: a `chat` Task recovers from a stale pointer by
 * creating a new executor, which a QA Task must never do — a fresh session
 * would drop the inherited context the group exists for.
 */
export type PetSourceKind = 'session' | 'workspace' | 'none' | 'chat' | 'qa-chat'

/**
 * Whether a Task's "executor" is a fork child rather than a Pet root executor.
 *
 * The distinction decides whether Pet may compose that Agent at all. A
 * `qa-chat` Task points at a continuable child of a USER session: DSH's
 * subagent machinery composes and drives it, and its value comes entirely
 * from the tool surface and context it INHERITED from its parent. Pet
 * therefore installs neither a preset, nor its allowlist Skill provider, nor
 * `pet_context` on it.
 *
 * Named as a predicate rather than written inline because the condition is
 * subtle and the field it reads is shared: a `qa-chat` Task stores its child's
 * session id in the SAME `executorSessionId` field a root executor uses, so
 * ANY lookup by that id matches both forms. A future site that resolves a Task
 * from a live Agent must ask this question before composing anything.
 *
 * Skipping it cost exactly that: Pet's `agent/created` observer matched a QA
 * child, installed `pet_context` on it, and the model — told by the tool's own
 * description to call it at the start of every Invocation — got
 * `NO_CURRENT_INVOCATION`. QA delivery queues a child turn straight into the
 * inbox and never creates an Invocation, so that lookup cannot succeed for
 * this form at all.
 * @param sourceKind - The Task's source kind.
 * @returns whether Pet must leave this Agent's composition alone.
 */
export function isForkChildTaskForm(sourceKind: PetSourceKind): boolean {
  return sourceKind === 'qa-chat'
}

/**
 * Stable scope key that defines active-Task uniqueness.
 *
 * `qa:` is keyed on the SOURCE SESSION rather than on the chat, because a QA
 * group's chat id does not exist until that group has been created — a
 * chat-keyed scope could never match an earlier group, so every click would
 * build another one. Namespaced apart from `session:` so one source session
 * can hold an overlay Task and a QA group at the same time.
 */
export type PetScopeKey =
  | `session:${string}`
  | `workspace:${string}`
  | `chat:${string}`
  | `qa:${string}`
  | 'independent:web:default'

/** The phase-one independent scope key. */
export const INDEPENDENT_SCOPE_KEY: PetScopeKey = 'independent:web:default'

/**
 * Build the canonical scope key for a source selection.
 *
 * The scope key is the only active-uniqueness authority; titles and start
 * messages are visible projections and are never parsed back into routing.
 * @param kind - Selected source kind.
 * @param id - Source session, workspace or chat id; ignored for `none`.
 * @returns the canonical scope key.
 */
export function scopeKeyOf(kind: PetSourceKind, id?: string): PetScopeKey {
  if (kind === 'none') return INDEPENDENT_SCOPE_KEY
  if (id === undefined || id === '') throw new Error(`Pet source kind ${kind} requires an id`)
  if (kind === 'session') return `session:${id}`
  if (kind === 'chat') return `chat:${id}`
  if (kind === 'qa-chat') return `qa:${id}`
  return `workspace:${id}`
}

// ---------------------------------------------------------------------------
// Durable Pet entities
// ---------------------------------------------------------------------------

/** Execution state of a Pet Task, kept strictly separate from its archive state. */
export type PetTaskStatus =
  | 'creating-executor'
  | 'idle'
  | 'running'
  | 'waiting-user'
  | 'failed'
  | 'recovering'

/** Terminal Task statuses that permit archival without an explicit cancellation. */
export const TERMINAL_TASK_STATUSES: readonly PetTaskStatus[] = ['idle', 'failed']

/** Execution state of one Pet Invocation. */
export type PetInvocationStatus =
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'waiting-user'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'recovering'

/** Invocation statuses that no longer occupy the Task's single current slot. */
export const TERMINAL_INVOCATION_STATUSES: readonly PetInvocationStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
]

/**
 * Whether an Invocation still occupies the per-Task serial slot.
 * @param status - Invocation status to classify.
 * @returns whether the Invocation is the current, non-settled one.
 */
export function occupiesCurrentSlot(status: PetInvocationStatus): boolean {
  return !TERMINAL_INVOCATION_STATUSES.includes(status)
}

/** Availability of the source behind a Task, projected for display only. */
export type PetSourceAvailability = 'available' | 'archived' | 'missing'

export interface PetTaskRecord {
  readonly id: string
  readonly scopeKey: PetScopeKey
  readonly epoch: number
  readonly sourceKind: PetSourceKind
  readonly sourceId?: string
  /** Human-readable source title captured when the Task was created. */
  readonly sourceTitle?: string
  readonly sourceAvailability: PetSourceAvailability
  readonly executorSessionId: string
  /**
   * Workspace the executor session lives IN, for workspace-resident Tasks.
   *
   * Absent on every ordinary Task, whose executor runs in the dedicated
   * `DSH Pet` workspace and reaches its source through the trusted snapshot.
   * Present only when a channel route placed the executor directly inside a
   * target workspace — a form in which Pet does NOT promise its Skill
   * allowlist projection or standing instructions.
   */
  readonly residentWorkspaceId?: string
  readonly status: PetTaskStatus
  readonly diagnostic?: string
  readonly archivedAt?: number
  readonly createdAt: number
  readonly updatedAt: number
  /** Optimistic-concurrency fence for every mutation and archive transition. */
  readonly revision: number
}

export interface PetInvocationRecord {
  readonly id: string
  readonly taskId: string
  readonly capabilityId: string
  /**
   * Skill name resolved at acceptance time.
   *
   * ABSENT for a conversational Invocation — one raised by an inbound channel
   * message rather than by clicking a capability. Such an Invocation carries a
   * question, not a Skill to run, so there is no name to pin, no `/<name>`
   * token to lead the envelope with, and nothing for the pre-dispatch Skill
   * check to verify.
   */
  readonly skillName?: string
  /** Registered directory at acceptance time, recorded for diagnostics. */
  readonly skillSourcePath?: string
  /** Pet skill-set generation active when the Invocation was accepted. */
  readonly skillSetGeneration?: number
  readonly snapshotId: string
  /** Free-text user request, rendered into the visible envelope. */
  readonly request?: string
  readonly status: PetInvocationStatus
  /** Durable FIFO ordering within the owning Task. */
  readonly queuePosition: number
  readonly resultSummary?: string
  readonly errorSummary?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
}

/** Immutable source facts fixed at Invocation acceptance time. */
export interface PetSourceSnapshot {
  readonly id: string
  readonly invocationId: string
  readonly sourceKind: PetSourceKind
  readonly sourceSessionId?: string
  readonly sourceWorkspaceId?: string
  readonly sessionTitle?: string
  readonly workspaceTitle?: string
  /** Repository root reported by the source session header. */
  readonly cwd?: string
  /** Durable session event position proving where the snapshot was taken. */
  readonly asOfSeq?: number
  /** Optional Worktree Session facts, absent when that plugin is not installed. */
  readonly worktree?: PetWorktreeFacts
  /** Optional side-effect-free SCM facts. */
  readonly scm?: PetScmFacts
  readonly capturedAt: number
}

export interface PetWorktreeFacts {
  /** Managed execution root, which differs from the session header cwd by design. */
  readonly executionRoot: string
  readonly branch?: string
  readonly dependencyMode?: string
  readonly lifecycle?: string
}

export interface PetScmFacts {
  readonly branch?: string
  readonly head?: string
  readonly remote?: string
}

/** One execution attempt of an Invocation. Retries reuse the Invocation snapshot. */
export interface PetRunRecord {
  readonly id: string
  readonly invocationId: string
  readonly attempt: number
  readonly status: PetInvocationStatus
  readonly errorSummary?: string
  readonly startedAt: number
  readonly settledAt?: number
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export interface PetCapability {
  readonly id: string
  /** Always the Skill name: Pet reads no Pet-specific label from a Skill. */
  readonly label: string
  readonly description: string
  readonly skillName: string
  /**
   * Where this wheel entry comes from.
   *
   * `skill` is the ordinary case: a Skill the user imported and enabled, run
   * through the Invocation path. `builtin` is a Host action (Q&A) that is NOT
   * a Skill at all — it never enters the allowlist model, emits no
   * `/<skill-name>` envelope, and its availability is probed by the Host. The
   * two share the wheel because the wheel is a shortcut surface, not a Skill
   * listing.
   */
  readonly kind: 'skill' | 'builtin'
  /** Computed: a missing organization-specific dependency disables rather than breaks Pet. */
  readonly available: boolean
  readonly diagnostic?: string
  /**
   * Whether the capability appears in the radial shortcut menu. A hidden
   * capability stays installed, enabled and invocable elsewhere — this
   * controls menu clutter only, never authorization.
   */
  readonly showAsShortcut: boolean
}

// ---------------------------------------------------------------------------
// Skill store
// ---------------------------------------------------------------------------

/** Every Skill is added by the user; Pet ships no privileged built-ins. */
export type PetSkillProvenanceKind = 'local-link'

export interface PetSkillProvenance {
  readonly kind: PetSkillProvenanceKind
  /** Directory the user registered, echoed for diagnostics. */
  readonly sourcePath?: string
  readonly installedAt: number
}

export interface PetSkillRevision {
  readonly skillName: string
  /** Canonical directory on the Host that the projection links to. */
  readonly sourcePath: string
  readonly description: string
  /**
   * Free-text arguments appended after the skill token on every dispatch.
   *
   * Pet does not parse them: the Skill's instructions decide what they mean.
   */
  readonly arguments?: string
  readonly provenance: PetSkillProvenance
  readonly fileCount: number
  readonly totalBytes: number
}

/** Per-skill selection state: installed, enabled and shortcut visibility are separate facts. */
export interface PetSkillSelection {
  readonly skillName: string
  /** Whether the Skill is enabled; a Skill has no versions to choose between. */
  readonly enabled?: boolean
  readonly showAsShortcut: boolean
  /** Newer trusted built-in revision available but never silently applied. */
}

export type PetProjectionStatus = 'ok' | 'missing' | 'drifted' | 'not-a-symlink' | 'out-of-store'

export interface PetProjectionEntry {
  readonly skillName: string
  readonly status: PetProjectionStatus
  /** Canonical source directory this entry is expected to link to. */
  readonly expectedSourcePath?: string
  readonly resolvedTarget?: string
  readonly diagnostic?: string
}

// ---------------------------------------------------------------------------
// Invocation capture contract (Web -> Host)
// ---------------------------------------------------------------------------

/**
 * The immutable capture the browser sends when the user confirms an Invocation.
 * The Host never consults the browser's live `current` selection again for this
 * Invocation.
 */
export interface PetInvocationCapture {
  /** Stable client-generated id making the create call idempotent. */
  readonly clientInvocationId: string
  readonly capabilityId: string
  readonly sourceKind: PetSourceKind
  readonly sourceSessionId?: string
  readonly sourceWorkspaceId?: string
  /** Browser-visible titles, revalidated Host-side and never trusted as authority. */
  readonly sessionTitle?: string
  readonly workspaceTitle?: string
  readonly request?: string
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Stable Pet error codes returned by every management route. */
export type PetErrorCode =
  | 'PET_DEGRADED'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_CAPABILITY'
  | 'CAPABILITY_UNAVAILABLE'
  | 'CONTEXT_REQUIRED'
  | 'SOURCE_NOT_FOUND'
  | 'TASK_NOT_FOUND'
  | 'TASK_ARCHIVED'
  | 'INVOCATION_NOT_FOUND'
  | 'NO_CURRENT_INVOCATION'
  | 'AMBIGUOUS_CURRENT_INVOCATION'
  | 'NOT_A_PET_SESSION'
  | 'REVISION_CONFLICT'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_DISABLED'
  | 'SKILL_DIGEST_MISMATCH'
  | 'SKILL_IMPORT_REJECTED'
  | 'PROJECTION_DRIFT'
  /** Workspace files an executor depends on are missing and could not be repaired. */
  | 'WORKSPACE_UNHEALTHY'
  | 'MODEL_UNAVAILABLE'
  | 'BINDING_INVALID'
  | 'ARCHIVE_BLOCKED'
  | 'LOCUS_UNAVAILABLE'
  | 'LOCUS_NOT_FOUND'
  | 'LOCUS_BUSY'
  | 'LOCUS_CONFLICT'
  | 'LOCUS_PERMISSION_DENIED'
  | 'WRITE_UNSUPPORTED'
  | 'LOCUS_INVALID'
  | 'LOCUS_STOPPED'
  | 'INTERNAL'

/** Uniform error body returned by Pet management routes. */
export interface PetErrorBody {
  readonly error: PetErrorCode
  readonly message: string
  /** Optional field-level details for validation failures; never contains secrets. */
  readonly fields?: Readonly<Record<string, string>>
}
