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

/**
 * Capability id recorded on an in-session follow-up Invocation.
 *
 * A user message typed directly into a Pet root executor session pins no
 * Skill: like the channel conversational form it is a request, not a
 * capability. The distinct id keeps that ORIGIN visible in the panel and in
 * diagnostics instead of being mistaken for a Skill name.
 */
export const SESSION_MESSAGE_CAPABILITY_ID = 'session-message'

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
 * Routes for the owner-imported mascot animation.
 *
 * Separate from `ROUTES` for the same reason as `LOCUS_ROUTES`: a declared
 * route must be registered exactly once, and these three are mounted together
 * by `createPetRoutes`. Read/import/remove are all POST because the browser
 * client's transport (`client/api.ts`) is POST-only and `petRoute` treats GET
 * as a body-less special case; one method keeps the contract and its tests in
 * a single shape.
 */
export const EXPRESSION_ROUTES = {
  /** Projection of the active expression: `none`, `ok` with source, or `corrupt`. */
  view: '/dsh-pet/api/expression',
  /** Validate and atomically store one pasted Lottie JSON source. */
  import: '/dsh-pet/api/expression-import',
  /** Deactivate the current expression, keeping one `.removed` backup. */
  remove: '/dsh-pet/api/expression-remove',
  /** Download one Lottie source from an HTTPS URL (Host-side fetch). */
  importUrl: '/dsh-pet/api/expression-import-url',
} as const

/** Maximum accepted JSON request body for an ordinary Pet management route. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024

/**
 * Body limit for the expression import route only.
 *
 * A 512 KiB source can grow up to about 6x under JSON string escaping (control
 * characters become `\uXXXX`), so the transport limit must clear the source
 * limit by a wide margin; otherwise a merely-oversized animation would be
 * reported as a generic "body too large" instead of an actionable source
 * validation error.
 */
export const MAX_EXPRESSION_REQUEST_BODY_BYTES = 4 * 1024 * 1024

/** Maximum accepted Lottie source bytes (UTF-8) for one mascot expression. */
export const MAX_EXPRESSION_SOURCE_BYTES = 512 * 1024

/** Maximum number of layers a Lottie source may expand to when rendered. */
export const MAX_EXPRESSION_LAYERS = 80

/** Maximum depth of precomp references between compositions. */
export const MAX_EXPRESSION_LAYER_DEPTH = 32

/** Maximum width/height a Lottie composition may declare. */
export const MAX_EXPRESSION_DIMENSION = 2048

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
  /** Complete owner-facing v20 locus management snapshot. */
  view: '/dsh-pet/api/locus',
  /** The one mutation endpoint: `stop` / `access` / `rebind` (design D10). */
  action: '/dsh-pet/api/locus-action',
  /** Explicit default-Q&A create/open operation (Pet wheel). */
  defaultQa: '/dsh-pet/api/locus-default-qa',
  // NOTE: the optional owner view/correction surface for shared facts is
  // deliberately NOT declared here yet. A declared route must be registered
  // exactly once, and shared facts are now written by in-scope agents, so this
  // operator surface stays undeclared until it is actually mounted.
  //
  // The two routes below ARE mounted (`pet-locus-intent-triage`). The shared
  // fact ledger's `todo` kind needs an owner-facing list and disposition
  // surface: a todo the owner can neither see nor close would defeat the
  // point of registering it instead of letting the request vanish.
  /** Owner-facing todo list for one main session's shared-fact ledger. */
  todos: '/dsh-pet/api/locus-todos',
  /** Owner-only disposition of one todo: accept / done / drop. */
  todoAction: '/dsh-pet/api/locus-todo-action',
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
  /** Comment entries: summary source, the earliest persisted anchored quote (display only). */
  readonly quote?: string
  /** Document entries: the `drive +inspect` URL, when readable (display only). */
  readonly docUrl?: string
}

/** Endpoint fields accepted as a bind/rebuild intent (display facts excluded). */
export type PetLocusEndpointInput = Pick<PetLocusEndpointView, 'chatId' | 'threadId'>

/** Alias used by Host adapters that refer to this as an endpoint value. */
export type PetLocusEndpoint = PetLocusEndpointView

/** Workspace ownership derived from the main session. */
export interface PetLocusWorkspaceView {
  readonly workspaceId: string
  readonly title?: string
  /** Display-only path; omitted when the Host cannot resolve one safely. */
  readonly path?: string
  /** Confirmed execution-root anchor, not a sandbox authorization claim. */
  readonly executionRoot?: string
}

// ---------------------------------------------------------------------------
// Optional B035 owner presentation facts
// ---------------------------------------------------------------------------

/**
 * How a locus child obtained its conversation context.  This is a display
 * classification only: it never changes the child permission or execution
 * policy.  Missing evidence is deliberately represented as `unknown`.
 */
export type PetLocusContextMode = 'fork-prefix-v1' | 'independent-v1' | 'unknown'

/** Host capability to dispatch an isolated inquiry turn. */
export type PetLocusInquiryDispatchCapability = 'available' | 'unavailable' | 'unknown'

/** Whether the Host could provide a current inquiry snapshot. */
export type PetLocusInquirySnapshotStatus = 'available' | 'unavailable' | 'unknown'

/** Durable inquiry states safe to display without exposing question/answer text. */
export type PetLocusInquiryStatus =
  | 'queued'
  | 'executing'
  | 'answered'
  | 'result-delivered'
  | 'rejected'
  | 'unavailable'
  | 'cancelled'
  | 'needs-review'
  | 'unknown'

/** Machine diagnostic code; prose, question and answer bodies never cross this seam. */
export interface PetLocusDiagnosticView {
  readonly code: string
  readonly at?: number
}

/** One owner-visible inquiry status row, when a real Host snapshot exists. */
export interface PetLocusInquiryView {
  /** Stable opaque id for owner diagnosis; never sent to Feishu. */
  readonly inquiryId?: string
  readonly status: PetLocusInquiryStatus
  /** Acceptance time; the client derives waiting age from this value. */
  readonly createdAt: number
  /** Stable failure/review code, not a human message. */
  readonly reason?: string
  readonly diagnostics?: readonly PetLocusDiagnosticView[]
}

/** Additive, typed seam for B035 inquiry presentation. */
export interface PetLocusInquiryProjection {
  readonly dispatchCapability?: PetLocusInquiryDispatchCapability
  readonly snapshotStatus?: PetLocusInquirySnapshotStatus
  /** Omitted when no real inquiry ledger/diagnostic snapshot is available. */
  readonly inquiries?: readonly PetLocusInquiryView[]
  readonly diagnostics?: readonly PetLocusDiagnosticView[]
}

/**
 * Owner-only public collaboration facts.  These are separate from the local
 * context anchor below so shared notes cannot be mistaken for execution-root
 * or permission authority.  The source list contains provenance labels only;
 * it is not a member list or a downloaded resource.
 */
export interface PetLocusPublicContextView {
  readonly status?: 'authored' | 'unknown'
  readonly revision?: number
  readonly writer?: string
  readonly source?: readonly string[]
  readonly sharingScope?: string
  readonly workDescription?: string | null
  readonly resourceReferences?: readonly string[] | null
  readonly commonConstraints?: readonly string[] | null
}

/**
 * Optional owner-management facts.  The Host may omit this whole object when
 * B035 evidence is not composed; clients must then render unknown/unavailable
 * rather than manufacturing inquiry rows or context revisions.
 */
export interface PetLocusOwnerProjection {
  readonly mode?: PetLocusContextMode
  readonly inquiry?: PetLocusInquiryProjection
  readonly publicContext?: PetLocusPublicContextView
}

// ---------------------------------------------------------------------------
// Shared-fact ledger: owner-facing todo surface (`pet-locus-intent-triage`)
// ---------------------------------------------------------------------------

export type PetTodoStatus = 'open' | 'accepted' | 'done' | 'dropped'

/** Owner-visible disposition actions, mirroring the pure model's legal transitions. */
export type PetTodoAction = 'accept' | 'done' | 'drop'

/**
 * One todo as the owner-facing panel reads it.
 *
 * Carries the routing facts (`endpoint`, `triggerMessageId`) the panel needs
 * to build a Feishu jump, and `locusId` for the session jump — but never the
 * child session id directly: the panel resolves the CURRENT generation's
 * child through the locus view, so a jump target is never a stale instance.
 */
export interface PetTodoView {
  readonly itemId: string
  readonly locusId: string
  /** Generation at registration time on pre-v20 rows; absent on newer ones. Audit fact only; never used to address. */
  readonly generation?: number
  readonly endpoint: PetLocusEndpointView
  readonly triggerMessageId: string
  readonly requestedBy: string
  readonly summary: string
  readonly detail: string
  readonly status: PetTodoStatus
  readonly createdAt: number
  readonly statusChangedAt: number
  /**
   * Registered before the collaboration-space migration and kept read-only
   * ("旧版"): shown and jumpable, never accepted, done or dropped. Absent on
   * every todo that lives in the Locus collaboration space.
   */
  readonly legacy?: true
}

/** A record addressed to the Pet proxy that could not be routed to any locus (design D5 rule 3). */
export interface PetUnroutableView {
  readonly seq: number
  readonly at?: number
  readonly subject: 'message' | 'request-terminal'
  readonly messageId?: string
  readonly itemId?: string
}

/** The complete owner-facing todo snapshot for one main session's ledger. */
export interface PetTodoListView {
  readonly parentSessionId: string
  readonly items: readonly PetTodoView[]
  /**
   * Whether the collaboration layer could be read for this ledger. When
   * `unavailable`, `items` holds only legacy todos and must not be read as
   * "nothing new was filed". Absent from Hosts that predate the field.
   */
  readonly collab?: 'available' | 'unavailable'
  /** Records the proxy received but could not route; owner-only. */
  readonly unroutable?: readonly PetUnroutableView[]
}

/** One main session's ledger group in the todo list response; additive over `PetTodoListView`. */
export type PetTodoLedgerView = PetTodoListView

/** Request body for the todo disposition route. */
export interface PetTodoActionRequest {
  readonly itemId: string
  readonly action: PetTodoAction
}

/**
 * One-shot result of an accept's follow-up dispatch.
 *
 * `dispatched` and `queued` differ only by the target's status read BEFORE
 * dispatch — the follow-up call is synchronous and void, so it never reports
 * when the target actually starts. `queued` is a success, not a failure.
 *
 * `executionTarget` is present only when a dispatch happened, and exists so the
 * panel can navigate without re-deriving the target: which session runs a
 * follow-up is a Host resolution decision, and a front end that guessed it
 * would reintroduce the hardcoded "always the main session" assumption.
 *
 * Deliberately NOT persisted to the todo: this describes one operation, not the
 * record, so it must never be inferred from a later re-read.
 */
export interface PetTodoDispatchReceipt {
  readonly outcome: 'dispatched' | 'queued' | 'unreachable'
  readonly reason?: string
  readonly executionTarget?: { readonly kind: 'session'; readonly sessionId: string }
}

/** Response of the todo disposition route: the row, plus an accept's receipt. */
export interface PetTodoActionResult {
  readonly todo: PetTodoView
  readonly dispatch?: PetTodoDispatchReceipt
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

/**
 * Stable scalar route constants for integrations that import one path rather
 * than the complete route map.
 */
export const LOCUS_VIEW_ROUTE = LOCUS_ROUTES.view
export const LOCUS_ACTION_ROUTE = LOCUS_ROUTES.action

// ---------------------------------------------------------------------------
// v20 isomorphic-entry management wire (openspec pet-locus-isomorphic-entries)
//
// ADDITIVE contract freeze (task 1.3). Everything below carries a `V20` suffix
// and lives beside the pre-v20 types above; the owners of the management
// surface (2D) and the Host routes migrate callers onto these and delete the
// old `PetLocus*` shapes in their own scope. Nothing here imports from the
// Host: the client bundle compiles this file on its own.
// ---------------------------------------------------------------------------

/** The five Host error codes of the v20 locus actions (design D5, D6, D8). */
export const PET_LOCUS_ERROR_CODES_V20 = [
  'INVALID_REQUEST',
  'LOCUS_NOT_FOUND',
  'LOCUS_CONFLICT',
  'LOCUS_BUSY',
  'EXPLICIT_PARENT_CONFLICT',
] as const

export type PetLocusErrorCodeV20 = (typeof PET_LOCUS_ERROR_CODES_V20)[number]

/** Error body of a refused v20 locus action. */
export interface PetLocusErrorBodyV20 {
  readonly error: PetLocusErrorCodeV20
  readonly message: string
}

/** Exactly the four row states of v20 (design D2); snapshot validation accepts no others. */
export const PET_LOCUS_STATES_V20 = ['not-created', 'active', 'invalid', 'stopped'] as const

export type PetLocusStateV20 = (typeof PET_LOCUS_STATES_V20)[number]

/** The one access value of an entry (design D8). */
export const PET_LOCUS_ACCESS_MODES_V20 = ['read-only', 'danger-full-access'] as const

export type PetLocusAccessModeV20 = (typeof PET_LOCUS_ACCESS_MODES_V20)[number]

/** The work session (W) a group of entries serves; availability describes W (design D10). */
export interface PetLocusWorkViewV20 {
  readonly sessionId: string
  readonly title?: string
  /** `unknown`: the cold read could not prove it. Rebind is greyed for anything but `archived`. */
  readonly availability: 'available' | 'archived' | 'missing' | 'unknown'
}

/** The locus main session (M) a chat's entries hang under. */
export interface PetLocusMainViewV20 {
  readonly sessionId: string
  readonly title?: string
  readonly availability?: 'available' | 'archived' | 'missing'
}

/**
 * One entry row: a chat/doc root (group row) or a topic/comment (topic row).
 * No generation, permission, toolTier, contextAnchor, childComposition or
 * history count exists (design D2, D10).
 */
export interface PetLocusEntryViewV20 {
  readonly locusId: string
  /** Fence value for stop / access / rebind. */
  readonly revision: number
  readonly endpoint: PetLocusEndpointView
  /** Reserved-or-created session id; `state` says whether it exists yet. */
  readonly sessionId: string
  /**
   * Cold-read facts of the entry's child session. Omitted on `not-created`
   * rows: the reserved id names no session yet and is never cold-read.
   * `unknown` = the read could not prove it; it fails closed like W's.
   */
  readonly session?: {
    readonly title?: string
    readonly availability?: 'available' | 'archived' | 'missing' | 'unknown'
  }
  readonly state: PetLocusStateV20
  readonly invalidReason?: string
  readonly accessMode: PetLocusAccessModeV20
  readonly grantedBy?: string
  readonly verifiedAt?: number
  /** Any non-terminal Delivery exists: drives the 「投递中」 badge and greys stop / access (design D10). */
  readonly inFlight: boolean
  /** A `current` (queued / running / finishing included) Delivery exists: the only thing that greys rebind (design D10). */
  readonly hasCurrentDelivery: boolean
  readonly createdAt: number
  readonly updatedAt: number
  readonly stoppedAt?: number
}

/** A group row (chat or document root) with the topic rows nested under it by `chatId`. */
export interface PetLocusChatViewV20 {
  readonly group: PetLocusEntryViewV20
  readonly topics: readonly PetLocusEntryViewV20[]
  readonly locusMain: PetLocusMainViewV20
  readonly workspace: PetLocusWorkspaceView
  /** The archived W this chat was rebound from, when it was rebound; title when cold-readable. */
  readonly reboundFrom?: { readonly sessionId: string; readonly title?: string }
  /** This group is its M's default Q&A group. Group rows only. */
  readonly defaultQa?: boolean
}

/** Chats grouped by the work session they serve. */
export interface PetLocusWorkGroupViewV20 {
  readonly work: PetLocusWorkViewV20
  readonly chats: readonly PetLocusChatViewV20[]
}

/** Complete v20 management snapshot. */
export interface PetLocusManagementViewV20 {
  /** Monotonic snapshot generation. */
  readonly generation: number
  readonly works: readonly PetLocusWorkGroupViewV20[]
  /** `LOCUS_WRITE_ENABLED`: when false only the 「完全访问」 option is disabled (design D8, D10). */
  readonly writeEnabled: boolean
}

/** The only fence of a v20 mutation: the entry row's identity and revision (design D3). */
export interface PetLocusFenceV20 {
  readonly expectedLocusId: string
  readonly expectedRevision: number
}

/** Stop one entry; accepted only when it has no non-terminal Delivery (design D7). */
export interface PetLocusStopActionV20 extends PetLocusFenceV20 {
  readonly action: 'stop'
  readonly endpoint: PetLocusEndpointInput
}

/** Set one entry's access mode (design D8). */
export interface PetLocusAccessActionV20 extends PetLocusFenceV20 {
  readonly action: 'access'
  readonly endpoint: PetLocusEndpointInput
  readonly accessMode: PetLocusAccessModeV20
}

/** Rebind a chat whose W is archived to another W (design D6). The fence is the group row's. */
export interface PetLocusRebindActionV20 extends PetLocusFenceV20 {
  readonly action: 'rebind'
  readonly chatId: string
  /** Full sessionId of the new work session; a short code is never resolved. */
  readonly workSessionId: string
}

/** Read-only actions that share the route (design D10). */
export interface PetLocusViewActionV20 {
  readonly action: 'view'
}

export interface PetLocusDefaultQaActionV20 {
  readonly action: 'defaultQa'
  readonly parentSessionId: string
  readonly groupName?: string
}

export interface PetLocusTodosActionV20 {
  readonly action: 'todos'
}

/** The v20 `locus-action` request union (replaces `PetLocusActionRequest`). */
export type PetLocusActionRequestV20 =
  | PetLocusStopActionV20
  | PetLocusAccessActionV20
  | PetLocusRebindActionV20
  | PetLocusViewActionV20
  | PetLocusDefaultQaActionV20
  | PetLocusTodosActionV20

/** Result of a v20 stop / access / rebind: the chat as it is after the action. */
export interface PetLocusActionResultV20 {
  readonly action: 'stop' | 'access' | 'rebind'
  readonly chat: PetLocusChatViewV20
  /** Honest receipt text; an access change never claims it was applied (design D8). */
  readonly receipt?: string
}

/** Result of the `defaultQa` create/open operation (Pet wheel): the Q&A chat as it is now. */
export interface PetLocusDefaultQaResultV20 {
  readonly action: 'default-qa'
  readonly chat: PetLocusChatViewV20
  readonly created?: boolean
  readonly reused?: boolean
}
export const LOCUS_DEFAULT_QA_ROUTE = LOCUS_ROUTES.defaultQa

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
  /**
   * Client message id that raised this Invocation, for the in-session form.
   *
   * Set only when the Invocation was registered from a user message typed
   * directly into the root executor session. It is the durable idempotency
   * key for that origin — the same message must never register a second
   * Invocation — and it is NEVER read as authority: the trusted context still
   * resolves its caller from the executing session.
   */
  readonly followupMessageId?: string
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
/** Projection of the owner-imported mascot animation. */
export type PetExpressionView =
  | { readonly state: 'none' }
  | {
      readonly state: 'ok'
      /** Raw Lottie source exactly as imported; never parsed or rewritten. */
      readonly content: string
      /** UTF-8 byte length read from disk. */
      readonly bytes: number
      /** Filesystem mtime of the active source, in epoch milliseconds. */
      readonly importedAt: number
    }
  | {
      readonly state: 'corrupt'
      /** Human-readable reason the stored source cannot be used. */
      readonly diagnostic: string
    }

/** Successful import projection. */
export interface PetExpressionImportResult {
  readonly state: 'ok'
  readonly bytes: number
}

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
  | 'INVALID_EXPRESSION'
  /** A URL import failed to download a usable body (network/status/type/size). */
  | 'EXPRESSION_FETCH_FAILED'
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
  | 'COLLABORATION_UNAVAILABLE'
  | 'COLLABORATION_REVISION_CONFLICT'
  | 'INTERNAL'

/** Uniform error body returned by Pet management routes. */
export interface PetErrorBody {
  readonly error: PetErrorCode
  readonly message: string
  /** Optional field-level details for validation failures; never contains secrets. */
  readonly fields?: Readonly<Record<string, string>>
}
