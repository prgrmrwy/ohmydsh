/**
 * Pure admission decisions for the unified Locus collaboration channel.
 *
 * This module deliberately has no repository, Lark client, or DSH runtime
 * dependency.  The channel adapter supplies an already parsed event and the
 * caller supplies the current authorization/replay facts.  That keeps the
 * trust boundary deterministic and lets the controller decide what to do with
 * an admitted request without making this module know how a locus is stored.
 */

import type { LarkInboundEvent } from '../channel/event.js'
import type { LocusAccessModeV20, LocusRepositoryPortV20, LocusRowV20 } from './contract-v20.js'
import { STORAGE_KEY_SEPARATOR, containsStorageKeySeparator } from './storage-key.js'

/** The two possible parts of a Locus address. */
export interface LocusEndpoint {
  /** Lark chat id (group or p2p). */
  readonly chatId: string
  /** Stable thread id, when this event is addressed to a thread. */
  readonly threadId?: string
  /** Stable serialized key used by indexes. */
  readonly key: string
}

/** Why endpoint extraction stopped without choosing an address. */
export type EndpointRefusal =
  | 'invalid-chat'
  | 'invalid-thread'

/** Result of extracting a Locus address from one inbound event. */
export type EndpointExtraction =
  | { readonly ok: true; readonly endpoint: LocusEndpoint }
  | { readonly ok: false; readonly reason: EndpointRefusal }

/**
 * Lifecycle/authorization state known for an endpoint.
 *
 * `authorized` is the only state that gives a group the member-at exemption.
 * `uninitialized` is intentionally separate from a missing record: an
 * allowlisted sender may use its first mention to create the new structure.
 * `retired` (stopped, or W archived) is a terminal protection state and never
 * falls through to a default identity.
 */
export type LocusAuthorizationState =
  | 'authorized'
  | 'uninitialized'
  /**
   * The owner deliberately took this endpoint out of service (`stopped` /
   * `retired`). Spec: "明确退出的入口 SHALL 保留停止标记，普通 at MUST NOT
   * 自动复活" — an ordinary mention must not resurrect it.
   */
  | 'retired'
  /**
   * The Host itself judged the entry unusable (`invalid`): the child was
   * lost or its identity could not be proven (D7 class A). The owner
   * never asked for this, so the "do not auto-resurrect an explicit exit"
   * rule does not apply: treating it like a deliberate exit stranded the
   * endpoint; the next authorized @ rebuilds it in place instead.
   */
  | 'unusable'

/**
 * The subset of {@link LocusAuthorizationState} that ordinary work may proceed
 * under: an existing serviceable locus (`authorized`), or an endpoint the
 * channel is allowed to bootstrap itself — `uninitialized` for one it has
 * never seen, `unusable` for a row the Host invalidated without any
 * owner decision.
 *
 * Every consumer that gates ordinary work MUST use
 * {@link isAdmittableAuthorization} instead of restating the union. The
 * channel controller restated `'authorized' | 'uninitialized'` in two places,
 * so adding `unusable` above admitted the message through admission and then
 * silently rejected it one layer later as `authorization-unresolved` — the
 * very deadlock the new state existed to remove, wearing a different reason
 * code and with no compile error to catch it.
 */
export type AdmittableLocusAuthorization = Extract<
  LocusAuthorizationState,
  'authorized' | 'uninitialized' | 'unusable'
>

/** Whether ordinary (non-control) work may proceed under this state. */
export function isAdmittableAuthorization(
  state: LocusAuthorizationState,
): state is AdmittableLocusAuthorization {
  return state === 'authorized' || state === 'uninitialized' || state === 'unusable'
}

/** Optional metadata a controller may attach to an authorization result. */
export interface LocusAuthorization {
  readonly state: LocusAuthorizationState
  readonly locusId?: string
  readonly reason?: string
  /** Endpoint itself is absent but an authorized parent group may initialize it. */
  readonly needsInitialization?: boolean
}

/** A resolver supplied by the locus controller/repository. */
export type LocusAuthorizationResolver = ((endpoint: LocusEndpoint) => LocusAuthorizationState | LocusAuthorization) & {
  /** The exact entry row's `accessMode`, in every state; `undefined` when no row exists (D8). */
  accessMode?: (endpoint: LocusEndpoint) => LocusAccessModeV20 | undefined
}

/** Narrow v20 durable view needed by production admission (owner A's repository). */
export type LocusAuthorizationStore = Pick<LocusRepositoryPortV20, 'getRow' | 'findMain'>

/**
 * Build production authorization from the v20 entry rows. A missing row is
 * bootstrap-able; lookup failures throw so admission returns
 * `authorization-unresolved` rather than silently creating a default identity.
 * `chat_bindings` is not read (D11).
 */
export function createDurableLocusAuthorizationResolver(
  store: LocusAuthorizationStore,
  /**
   * Whether a work session (W) is archived by its owner. An archived W takes
   * every entry under it out of service without rewriting `state` (D7). Absent
   * or throwing means "cannot know", which never takes a working entry down.
   */
  isWorkArchived?: (workSessionId: string) => boolean,
): LocusAuthorizationResolver {
  const workArchived = (chatId: string): boolean => {
    if (isWorkArchived === undefined) return false
    const group = store.getRow({ chatId })
    if (group === undefined || !('locusMainSessionId' in group)) return false
    const work = store.findMain(group.locusMainSessionId)?.workSessionId
    if (work === undefined) return false
    try {
      return isWorkArchived(work) === true
    } catch {
      return false
    }
  }

  const classify = (row: LocusRowV20, extra: { readonly needsInitialization?: true } = {}): LocusAuthorizationState | LocusAuthorization => {
    // An archived W outranks `active` / `not-created` / `invalid`: the owner
    // acted on the session, and an ordinary @ must neither serve nor rebuild.
    if (row.state !== 'stopped' && workArchived(row.endpoint.chatId)) {
      return { state: 'retired', reason: 'source-archived' }
    }
    if (row.state === 'active' || row.state === 'not-created') {
      return { state: 'authorized', locusId: row.locusId, ...extra }
    }
    // `stopped` is the owner's exit; `invalid` is a Host judgement that the
    // next authorized @ rebuilds in place.
    return row.state === 'stopped' ? 'retired' : 'unusable'
  }

  const resolve: LocusAuthorizationResolver = endpoint => {
    const exact = endpoint.threadId === undefined
      ? { chatId: endpoint.chatId }
      : { chatId: endpoint.chatId, threadId: endpoint.threadId }
    const current = store.getRow(exact)
    if (current !== undefined) return classify(current)
    if (endpoint.threadId === undefined) return 'uninitialized'

    // A new topic is authorized by its group row. A group the owner stopped
    // does not authorize a new topic; a missing group stays uninitialized for
    // an allowlisted first mention only.
    const group = store.getRow({ chatId: endpoint.chatId })
    if (group === undefined) return 'uninitialized'
    return classify(group, { needsInitialization: true })
  }
  resolve.accessMode = endpoint => store.getRow(endpoint.threadId === undefined
    ? { chatId: endpoint.chatId }
    : { chatId: endpoint.chatId, threadId: endpoint.threadId })?.accessMode
  return resolve
}

/** Control operations understood by the unified locus channel. */
export type LocusControlCommand =
  | { readonly kind: 'bind'; readonly prefix: string }
  | { readonly kind: 'bind-missing-prefix' }
  | { readonly kind: 'bind-invalid' }
  | { readonly kind: 'access'; readonly mode: LocusAccessModeV20 }
  | { readonly kind: 'access-missing-mode' }
  | { readonly kind: 'access-invalid'; readonly value: string }
  /** `/scope`, `/tools`, `-s`, `-t` (D8): change nothing; the receipt points to `/access`. */
  | { readonly kind: 'deprecated-tier'; readonly original: string }
  | { readonly kind: 'unbind' }
  /** `-h`, `--help`, `/help`: a pure information receipt; never creates anything. */
  | { readonly kind: 'help' }
  | { readonly kind: 'unbind-invalid' }

/** Input passed to an already-authorized control dispatcher. */
export interface LocusControlDispatchRequest {
  readonly command: LocusControlCommand
  readonly endpoint: LocusEndpoint
  readonly senderId: string
  /** Protected endpoints may enter only the explicit bind/rebuild control path. */
  readonly authorization?: LocusAuthorizationState
}

/** Result of a control-plane operation; it never creates a Delivery. */
export type LocusControlDispatchResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly silent: true; readonly text?: never }

/** Host-provided control surface for the unified channel. */
export interface LocusControlDispatchPort {
  dispatch(
    request: LocusControlDispatchRequest,
  ): LocusControlDispatchResult | PromiseLike<LocusControlDispatchResult>
}

/** Ordinary content, rather than a recognized control command. */
export type NoLocusControlCommand = { readonly kind: 'none' }

/** Result of parsing a command after leading bot mentions are removed. */
export type LocusCommandParse = LocusControlCommand | NoLocusControlCommand

/** Refusals emitted by {@link admitLocusEvent}. */
export type LocusAdmissionRefusal =
  | 'not-a-message'
  | 'missing-message-id'
  | 'invalid-endpoint'
  | 'bot-sender'
  | 'not-allowed-sender'
  | 'no-mention'
  | 'duplicate'
  | 'before-watermark'
  | 'unsupported-message-type'
  | 'empty-content'
  | 'uninitialized-endpoint'
  | 'retired-endpoint'
  | 'authorization-unresolved'
  | 'control-not-allowed'
  | 'owner-only-tier'
  | 'dedup-unavailable'

/**
 * Facts needed for one admission decision.
 *
 * `authorization` is preferred.  The additional static forms are deliberately
 * supported so a small controller can pass a snapshot without manufacturing a
 * callback; all forms use the same endpoint key and fail closed when absent.
 * There is no `isQaChat` escape hatch: group authorization is represented by
 * the explicit `authorized` Locus state only.
 */
export interface LocusAdmissionContext {
  /** Verified open_id of this bot. Required for both group and p2p mentions. */
  readonly botOpenId?: string
  /** Global allowlist. It gates every control command. */
  readonly allowOpenIds: readonly string[]
  /** Messages created before this millisecond watermark are replays. */
  readonly watermark: number
  /** Return true when the message id was already accepted in the dedup window. */
  readonly isDuplicate: (messageId: string) => boolean
  /** Resolve authorization for the exact endpoint. */
  readonly authorization?: LocusAuthorizationResolver
  /** Alias accepted by integrations that call this operation a lookup. */
  readonly resolveAuthorization?: LocusAuthorizationResolver
  /** One snapshot state for all endpoints (normally `uninitialized`). */
  readonly authorizationState?: LocusAuthorizationState | LocusAuthorization
  /** Endpoint-keyed snapshot states. */
  readonly authorizationByEndpoint?: Readonly<Record<string, LocusAuthorizationState | LocusAuthorization>>
  /** Explicitly authorized endpoint keys. */
  readonly authorizedEndpoints?: ReadonlySet<string> | readonly string[]
  /** Explicitly authorized chat ids; useful for group-level member-at policy. */
  readonly authorizedChats?: ReadonlySet<string> | readonly string[]
  /** The exact entry row's `accessMode` in any state (D8); `danger-full-access` is owner-only. */
  accessMode?: (endpoint: LocusEndpoint) => LocusAccessModeV20 | undefined
}

/** A successful admission, including the exact endpoint the controller must use. */
export interface LocusAdmission {
  readonly admit: true
  readonly endpoint: LocusEndpoint
  readonly text: string
  readonly senderId: string
  readonly authorization: LocusAuthorizationState
  /** True when the controller must perform first-time locus initialization. */
  readonly needsInitialization: boolean
  /** Present only for a recognized, allowlist-authorized control command. */
  readonly command?: LocusControlCommand
}

/** A refused admission. Refusals carry no reply/action payload. */
export interface LocusAdmissionRejection {
  readonly admit: false
  readonly reason: LocusAdmissionRefusal
  /** Present when the event had an unambiguous endpoint. */
  readonly endpoint?: LocusEndpoint
  /** Present when authorization was resolved before refusal. */
  readonly authorization?: LocusAuthorizationState
}

/** Complete outcome of the pure admission function. */
export type LocusAdmissionDecision = LocusAdmission | LocusAdmissionRejection

/** Serialize a Locus endpoint without putting parent/session ids in its key. */
export function locusEndpointKey(chatId: string, threadId?: string): string {
  return threadId === undefined ? chatId : `${chatId}${STORAGE_KEY_SEPARATOR}${threadId}`
}

/** Normalize an id while rejecting whitespace/control-character ambiguity. */
function normalizeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value === '' || value.trim() !== value || containsStorageKeySeparator(value) || /\s/.test(value)) {
    return undefined
  }
  return value
}

/**
 * Extract the exact Locus endpoint represented by an event.
 *
 * The platform's `thread_id` is the ONLY proof of thread membership, and it is
 * therefore the only fact that may put an event on a topic endpoint.  `root_id`
 * and `reply_to` are MESSAGE-level reply/quote facts: in a regular group a
 * quote carries both (equal to the quoted message id) while `thread_id` is
 * absent, and a reply inside a topic carries `thread_id` as well.  Reading them
 * as thread evidence used to refuse every quoted group message as
 * `ambiguous-thread`, which silently dropped the most common way a person asks
 * the bot something.  They must not derive, change, or veto an endpoint.
 *
 * Unusable values are handled by kind rather than by convenience: a corrupted
 * `thread_id` is a corrupted IDENTITY fact, so the event fails closed; a
 * corrupted `root_id`/`reply_to` is a missing optional CONTEXT fact, so only
 * that fact is dropped and the message is still addressed normally.
 */
export function extractLocusEndpoint(event: LarkInboundEvent): EndpointExtraction {
  const chatId = normalizeId(event.chat_id)
  if (chatId === undefined) return { ok: false, reason: 'invalid-chat' }

  const threadId = event.thread_id === undefined ? undefined : normalizeId(event.thread_id)
  if (event.thread_id !== undefined && event.thread_id !== '' && threadId === undefined) {
    return { ok: false, reason: 'invalid-thread' }
  }

  if (threadId !== undefined) {
    return {
      ok: true,
      endpoint: {
        chatId,
        threadId,
        key: locusEndpointKey(chatId, threadId),
      },
    }
  }

  return { ok: true, endpoint: { chatId, key: locusEndpointKey(chatId) } }
}


/** `/access read|full` argument → row value (D8). */
const ACCESS_COMMAND_MODES: Readonly<Record<string, LocusAccessModeV20>> = {
  read: 'read-only',
  full: 'danger-full-access',
}

/**
 * The ONE table of commands the parser accepts and the help receipt lists.
 * Deprecated tier verbs are accepted by the parser but deliberately absent.
 */
export interface LocusCommandTableEntry {
  readonly id: 'bind' | 'unbind' | 'access' | 'help'
  readonly verbs: readonly string[]
  readonly usage: string
  readonly description: string
  /** Every control command is gated by the allowlist (see admitCommon). */
  readonly allowlistOnly: boolean
}

export const LOCUS_COMMAND_TABLE: readonly LocusCommandTableEntry[] = [
  { id: 'bind', verbs: ['/bind', '-b', '--bind'], usage: '/bind <工作会话 id>', description: '把本入口绑定到工作会话（id 前缀至少 6 位）；已停止的入口对同一会话重新 /bind 即可启用', allowlistOnly: true },
  { id: 'unbind', verbs: ['/unbind', '-u', '--unbind'], usage: '/unbind', description: '停止本入口，会话与历史保留', allowlistOnly: true },
  { id: 'access', verbs: ['/access', '-a', '--access'], usage: '/access read|full', description: '设置本入口的访问模式：read 只读，full 完全访问（仅 allowlist 成员可再提问）', allowlistOnly: true },
  { id: 'help', verbs: ['/help', '-h', '--help'], usage: '/help', description: '显示本帮助', allowlistOnly: true },
]

const verbsOf = (id: LocusCommandTableEntry['id']): readonly string[] =>
  LOCUS_COMMAND_TABLE.find(entry => entry.id === id)!.verbs

const DEPRECATED_TIER_VERBS = new Set(['/scope', '-s', '--scope', '/tools', '-t', '--tools'])

/** Strip one or more leading @mention tokens from message text. */
function withoutLeadingMentions(text: string): string {
  return text.replace(/^(?:\s*@\S+)+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * Parse the control surface.  Recognition is intentionally narrow and only
 * considers a command at the beginning after leading mentions.  A malformed
 * recognized verb remains a control command so an unallowlisted sender cannot
 * smuggle it into the normal work path.
 */
export function parseLocusControlCommand(text: string): LocusCommandParse {
  const cleaned = withoutLeadingMentions(text)
  if (cleaned === '') return { kind: 'none' }

  const [verb = '', ...args] = cleaned.split(/\s+/)
  const lower = verb.toLowerCase()

  if (verbsOf('help').includes(lower)) return { kind: 'help' }

  if (verbsOf('unbind').includes(lower)) {
    return args.length === 0 ? { kind: 'unbind' } : { kind: 'unbind-invalid' }
  }

  if (verbsOf('bind').includes(lower)) {
    const prefix = args[0] ?? ''
    if (prefix === '') return { kind: 'bind-missing-prefix' }
    return args.length === 1 ? { kind: 'bind', prefix } : { kind: 'bind-invalid' }
  }

  if (verbsOf('access').includes(lower)) {
    const value = args[0]?.toLowerCase()
    if (value === undefined) return { kind: 'access-missing-mode' }
    const mode = args.length === 1 ? ACCESS_COMMAND_MODES[value] : undefined
    return mode === undefined ? { kind: 'access-invalid', value: args.join(' ') } : { kind: 'access', mode }
  }

  if (lower.startsWith('--access=')) {
    const value = lower.slice('--access='.length)
    const mode = args.length === 0 ? ACCESS_COMMAND_MODES[value] : undefined
    return mode === undefined ? { kind: 'access-invalid', value: [value, ...args].join(' ') } : { kind: 'access', mode }
  }

  // D8: the old tier verbs change nothing. They stay recognised so a sender
  // cannot smuggle them into the work path, and control answers "use /access".
  if (DEPRECATED_TIER_VERBS.has(lower) || lower.startsWith('--scope=') || lower.startsWith('--tools=')) {
    return { kind: 'deprecated-tier', original: cleaned }
  }

  if (lower.startsWith('--bind=')) {
    const prefix = cleaned.slice(verb.indexOf('=') + 1)
    if (prefix === '') return { kind: 'bind-missing-prefix' }
    return args.length === 0 ? { kind: 'bind', prefix } : { kind: 'bind-invalid' }
  }

  return { kind: 'none' }
}


/** Whether a collection contains one exact string. */
function includesValue(values: ReadonlySet<string> | readonly string[] | undefined, value: string): boolean {
  if (values === undefined) return false
  return values instanceof Set ? values.has(value) : (values as readonly string[]).includes(value)
}

/** Normalize a resolver's object/string form to one stable state. */
function stateOf(value: LocusAuthorizationState | LocusAuthorization): LocusAuthorizationState {
  const state = typeof value === 'string' ? value : value.state
  // Keep integrations that used an explicit group/locus wording source
  // compatible while exposing one canonical state to callers.
  if (state === 'authorized') return state
  if (state === 'uninitialized') return state
  if (state === 'retired') return state
  if (state === 'unusable') return state
  return 'uninitialized'
}

/** Internal lookup result, retaining resolver failure for fail-closed admission. */
type AuthorizationLookup =
  | { readonly resolved: true; readonly state: LocusAuthorizationState; readonly needsInitialization: boolean }
  | { readonly resolved: false }

/** Resolve authorization from the supported callback/snapshot forms. */
function lookupLocusAuthorization(
  endpoint: LocusEndpoint,
  context: LocusAdmissionContext,
): AuthorizationLookup {
  try {
    const resolved = (value: LocusAuthorizationState | LocusAuthorization): AuthorizationLookup => ({
      resolved: true,
      state: stateOf(value),
      needsInitialization: typeof value === 'object' && value.needsInitialization === true,
    })
    const resolver = context.authorization ?? context.resolveAuthorization
    if (resolver !== undefined) return resolved(resolver(endpoint))

    const snapshot = context.authorizationByEndpoint?.[endpoint.key]
    if (snapshot !== undefined) return resolved(snapshot)

    if (includesValue(context.authorizedEndpoints, endpoint.key)) {
      return { resolved: true, state: 'authorized', needsInitialization: false }
    }
    if (includesValue(context.authorizedChats, endpoint.chatId)) {
      return { resolved: true, state: 'authorized', needsInitialization: false }
    }

    if (context.authorizationState !== undefined) return resolved(context.authorizationState)
  } catch {
    // The caller cannot safely tell whether a failing lookup was authorized.
    return { resolved: false }
  }
  // No stored row is the explicit uninitialized state. It is not an error:
  // an allowlisted first @bot may bootstrap it.
  return { resolved: true, state: 'uninitialized', needsInitialization: true }
}

/**
 * Resolve an endpoint's authorization state without performing admission.
 * Resolver failures are represented as `uninitialized` for this value-only
 * helper; {@link admitLocusEvent} retains the failure and refuses the event.
 */
export function resolveLocusAuthorization(
  endpoint: LocusEndpoint,
  context: LocusAdmissionContext,
): LocusAuthorizationState {
  const lookup = lookupLocusAuthorization(endpoint, context)
  return lookup.resolved ? lookup.state : 'uninitialized'
}

/** Check the same verified bot mention rule for group and p2p events. */
export function mentionsLocusBot(event: LarkInboundEvent, botOpenId: string | undefined): boolean {
  if (botOpenId === undefined || botOpenId === '') return false
  return (event.mentions ?? []).some(mention => mention.id === botOpenId)
}

/**
 * Decide whether an inbound event may reach the unified locus controller.
 *
 * All messages, including p2p messages and control commands, must mention the
 * verified bot.  A group in `authorized` state grants ordinary @bot questions
 * to its members; it never grants control authority.  An uninitialized endpoint
 * can be bootstrapped only by a global allowlist sender.  Retired endpoints
 * never fall through to a new/default locus.
 */
export function admitLocusEvent(
  event: LarkInboundEvent,
  context: LocusAdmissionContext,
): LocusAdmissionDecision {
  if (event.type !== 'im.message.receive_v1') return { admit: false, reason: 'not-a-message' }
  if (typeof event.message_id !== 'string' || event.message_id === '') {
    return { admit: false, reason: 'missing-message-id' }
  }

  const extracted = extractLocusEndpoint(event)
  if (!extracted.ok) {
    return { admit: false, reason: 'invalid-endpoint' }
  }
  const endpoint = extracted.endpoint

  if (event.sender_type !== undefined && event.sender_type !== 'user') {
    return { admit: false, reason: 'bot-sender', endpoint }
  }

  const senderId = event.sender_id ?? ''
  const allowlisted = senderId !== '' && context.allowOpenIds.includes(senderId)
  if (senderId === '') return { admit: false, reason: 'not-allowed-sender', endpoint }

  // The mention check applies equally to p2p and group events.  A p2p event
  // with no mention array is not proof that this bot was addressed.
  if (!mentionsLocusBot(event, context.botOpenId)) {
    return { admit: false, reason: 'no-mention', endpoint }
  }

  if (event.message_type !== 'text' && event.message_type !== 'post') {
    return { admit: false, reason: 'unsupported-message-type', endpoint }
  }
  return admitCommon({
    endpoint,
    messageId: event.message_id,
    senderId,
    text: event.content ?? '',
    ...(event.create_time === undefined ? {} : { createTime: event.create_time }),
    // Only a group grants non-allowlisted member questions (see admitCommon).
    memberQuestions: event.chat_type === 'group',
  }, context)
}

/** Source-independent admission facts; each source proves its own preconditions first. */
export interface CommonAdmissionInput {
  readonly endpoint: LocusEndpoint
  readonly messageId: string
  readonly senderId: string
  readonly text: string
  /** Platform creation time, milliseconds as a string; absent skips the watermark. */
  readonly createTime?: string
  /** Whether an authorized entry here admits non-allowlisted askers (groups, docs). */
  readonly memberQuestions: boolean
}

/**
 * The admission rules every source shares: dedup, watermark, empty text,
 * authorization, control-command allowlist, retired refusal, owner-only
 * full access and the member-question rule. Written once so a group and a document
 * cannot drift (openspec pet-locus-doc-comments D7).
 */
export function admitCommon(input: CommonAdmissionInput, context: LocusAdmissionContext): LocusAdmissionDecision {
  const { endpoint, senderId } = input
  const allowlisted = senderId !== '' && context.allowOpenIds.includes(senderId)
  let duplicate: boolean
  try {
    duplicate = context.isDuplicate(input.messageId)
  } catch {
    return { admit: false, reason: 'dedup-unavailable', endpoint }
  }
  if (duplicate) return { admit: false, reason: 'duplicate', endpoint }

  const createdAt = Number(input.createTime ?? '0')
  if (Number.isFinite(createdAt) && createdAt > 0 && createdAt < context.watermark) {
    return { admit: false, reason: 'before-watermark', endpoint }
  }

  const text = input.text.trim()
  if (text === '') return { admit: false, reason: 'empty-content', endpoint }

  // Resolve after the transport/event gates.  A failing resolver is never a
  // reason to expose a default identity or bootstrap a new locus.
  const authorizationLookup = lookupLocusAuthorization(endpoint, context)
  if (!authorizationLookup.resolved) {
    return { admit: false, reason: 'authorization-unresolved', endpoint }
  }
  const authorization = authorizationLookup.state
  const parsed = parseLocusControlCommand(text)
  const isControl = parsed.kind !== 'none'
  if (isControl && !allowlisted) {
    return { admit: false, reason: 'control-not-allowed', endpoint, authorization }
  }

  // A protected endpoint remains unavailable for ordinary work. The sole
  // exception is an allowlisted, well-formed explicit bind: it enters the
  // control plane, where a same-W `/bind` re-enables a stopped entry (D7).
  const explicitRebuild = allowlisted && (parsed.kind === 'bind' || parsed.kind === 'help')
  if (authorization === 'retired' && !explicitRebuild) {
    return { admit: false, reason: 'retired-endpoint', endpoint, authorization }
  }

  // Only a group with an explicitly authorized locus can grant ordinary
  // non-allowlisted member questions.  P2P conversations remain allowlist
  // scoped because there is no group membership authorization to inherit.
  // D8: full access is owner-only in EVERY state of the row, not just `active`.
  const ownerOnlyTier = context.accessMode?.(endpoint) === 'danger-full-access'
  const canAskAsGroupMember = input.memberQuestions && authorization === 'authorized' && !ownerOnlyTier
  if (!allowlisted && ownerOnlyTier) {
    return { admit: false, reason: 'owner-only-tier', endpoint, authorization }
  }
  if (!allowlisted && !canAskAsGroupMember) {
    return { admit: false, reason: 'not-allowed-sender', endpoint, authorization }
  }

  const admission: LocusAdmission = {
    admit: true,
    endpoint,
    text,
    senderId,
    authorization,
    // `unusable` (an `invalid` row) is rebuilt in place by the next
    // authorized @ (D7): the Host invalidated it, the owner exited nothing.
    // The allowlist gate above still applies, so an ordinary member cannot
    // trigger the rebuild.
    needsInitialization: authorization === 'uninitialized'
      || authorization === 'unusable'
      || authorizationLookup.needsInitialization,
    ...(isControl ? { command: parsed } : {}),
  }
  return admission
}


/** Bounded message-id dedup helper for controllers without a repository. */
export class LocusMessageDedup {
  private readonly seen = new Map<string, number>()

  constructor(private readonly windowMs = 60_000) {}

  /** Record an id and report whether it was already seen in the window. */
  check(messageId: string, now = Date.now()): boolean {
    for (const [id, at] of this.seen) {
      if (now - at > this.windowMs) this.seen.delete(id)
    }
    if (this.seen.has(messageId)) return true
    this.seen.set(messageId, now)
    return false
  }
}

/** Familiar short name for callers that use the existing channel helper. */
export { LocusMessageDedup as MessageDedup }
