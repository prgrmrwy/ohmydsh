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
  | 'ambiguous-thread'

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
 * `retired` and `legacy` are terminal protection states and never fall through
 * to a default identity.
 */
export type LocusAuthorizationState =
  | 'authorized'
  | 'uninitialized'
  | 'retired'
  | 'legacy'

/** Optional metadata a controller may attach to an authorization result. */
export interface LocusAuthorization {
  readonly state: LocusAuthorizationState
  readonly locusId?: string
  readonly reason?: string
  /** Endpoint itself is absent but an authorized parent group may initialize it. */
  readonly needsInitialization?: boolean
}

/** A resolver supplied by the locus controller/repository. */
export type LocusAuthorizationResolver = (
  endpoint: LocusEndpoint,
) => LocusAuthorizationState | LocusAuthorization

/** Narrow durable view needed by production admission. */
export interface LocusAuthorizationStore {
  getLatestLocusByEndpoint(endpoint: { readonly chatId: string; readonly threadId?: string }):
    | { readonly id?: string; readonly state: 'provisioning' | 'active' | 'switching' | 'invalid' | 'retired' | 'stopped' }
    | undefined
}

/** Read-only legacy-retirement probe; it never supplies an execution identity. */
export interface LegacyRetirementProbe {
  find(endpoint: { readonly chatId: string; readonly threadId?: string }): unknown
}

/**
 * Build production authorization from the durable unified generation and the
 * read-only legacy retirement marker. A missing unified row is bootstrap-able
 * only when the legacy probe also proves the endpoint was never associated.
 * Lookup failures throw so admission returns `authorization-unresolved` rather
 * than silently creating a default identity.
 */
export function createDurableLocusAuthorizationResolver(
  store: LocusAuthorizationStore,
  legacy: LegacyRetirementProbe,
): LocusAuthorizationResolver {
  return endpoint => {
    const exact = endpoint.threadId === undefined
      ? { chatId: endpoint.chatId }
      : { chatId: endpoint.chatId, threadId: endpoint.threadId }
    const current = store.getLatestLocusByEndpoint(exact)
    if (current !== undefined) {
      return current.state === 'active'
        ? { state: 'authorized', ...(current.id === undefined ? {} : { locusId: current.id }) }
        : 'retired'
    }
    if (legacy.find(exact) !== undefined) return 'legacy'
    if (endpoint.threadId === undefined) return 'uninitialized'

    // A new topic is authorized by the durable chat-level locus. A retired,
    // stopped or invalid parent is terminal and must not be bypassed by topic
    // auto-provisioning; a missing parent remains uninitialized for an
    // allowlisted first mention only.
    const parent = store.getLatestLocusByEndpoint({ chatId: endpoint.chatId })
    if (parent === undefined) {
      return legacy.find({ chatId: endpoint.chatId }) === undefined ? 'uninitialized' : 'legacy'
    }
    return parent.state === 'active'
      ? { state: 'authorized', ...(parent.id === undefined ? {} : { locusId: parent.id }), needsInitialization: true }
      : 'retired'
  }
}

/** Control operations understood by the unified locus channel. */
export type LocusControlCommand =
  | { readonly kind: 'bind'; readonly prefix: string }
  | { readonly kind: 'bind-missing-prefix' }
  | { readonly kind: 'bind-invalid' }
  | { readonly kind: 'scope'; readonly mode: 'read' | 'write' }
  | { readonly kind: 'scope-missing-mode' }
  | { readonly kind: 'scope-invalid'; readonly value: string }
  | { readonly kind: 'unbind' }
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
  | 'ambiguous-thread'
  | 'bot-sender'
  | 'not-allowed-sender'
  | 'no-mention'
  | 'duplicate'
  | 'before-watermark'
  | 'unsupported-message-type'
  | 'empty-content'
  | 'uninitialized-endpoint'
  | 'retired-endpoint'
  | 'legacy-endpoint'
  | 'authorization-unresolved'
  | 'control-not-allowed'
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
  return threadId === undefined ? chatId : `${chatId}\u0000${threadId}`
}

/** Normalize an id while rejecting whitespace/control-character ambiguity. */
function normalizeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value === '' || value.trim() !== value || value.includes('\u0000') || /\s/.test(value)) {
    return undefined
  }
  return value
}

/**
 * Extract the exact Locus endpoint represented by an event.
 *
 * `thread_id` is authoritative when present.  `root_id` is inspected only as
 * evidence that a thread may exist: it is a message id, not a stable topic id,
 * so an event that has a root/reply fact but no canonical `thread_id` is
 * ambiguous and MUST NOT be silently treated as the chat-level endpoint.  A
 * normal event containing both a stable `thread_id` and a different root
 * message id is not ambiguous: the stable thread id wins and the root is merely
 * message context.
 */
export function extractLocusEndpoint(event: LarkInboundEvent): EndpointExtraction {
  const chatId = normalizeId(event.chat_id)
  if (chatId === undefined) return { ok: false, reason: 'invalid-chat' }

  const threadId = event.thread_id === undefined ? undefined : normalizeId(event.thread_id)
  if (event.thread_id !== undefined && event.thread_id !== '' && threadId === undefined) {
    return { ok: false, reason: 'invalid-thread' }
  }

  const rootId = event.root_id === undefined ? undefined : normalizeId(event.root_id)
  if (event.root_id !== undefined && event.root_id !== '' && rootId === undefined) {
    return { ok: false, reason: 'invalid-thread' }
  }

  const replyTo = event.reply_to === undefined ? undefined : normalizeId(event.reply_to)
  if (event.reply_to !== undefined && event.reply_to !== '' && replyTo === undefined) {
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

  // Without the canonical thread id, two different message-root candidates do
  // not prove one stable topic.  Refusing here prevents a reply in topic A
  // from being sent to the chat-level locus or topic B.
  if (rootId !== undefined || replyTo !== undefined) {
    return { ok: false, reason: 'ambiguous-thread' }
  }

  return { ok: true, endpoint: { chatId, key: locusEndpointKey(chatId) } }
}

/** Alias with the shorter name used by some controller integrations. */
export const resolveLocusEndpoint = extractLocusEndpoint
/** Alias matching the design document's resolver terminology. */
export const resolveEndpoint = extractLocusEndpoint
/** Alias for callers that use the noun-first form. */
export const endpointOf = extractLocusEndpoint

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

  if (lower === '/unbind' || lower === '-u' || lower === '--unbind') {
    return args.length === 0 ? { kind: 'unbind' } : { kind: 'unbind-invalid' }
  }

  if (lower === '/bind' || lower === '-b' || lower === '--bind') {
    const prefix = args[0] ?? ''
    if (prefix === '') return { kind: 'bind-missing-prefix' }
    return args.length === 1 ? { kind: 'bind', prefix } : { kind: 'bind-invalid' }
  }

  if (lower === '/scope' || lower === '-s' || lower === '--scope') {
    const value = args[0]?.toLowerCase()
    if (value === undefined) return { kind: 'scope-missing-mode' }
    if (args.length === 1 && (value === 'read' || value === 'write')) return { kind: 'scope', mode: value }
    return { kind: 'scope-invalid', value: args.join(' ') }
  }

  if (lower.startsWith('--scope=')) {
    const value = lower.slice('--scope='.length)
    if (args.length === 0 && (value === 'read' || value === 'write')) return { kind: 'scope', mode: value }
    return { kind: 'scope-invalid', value: [value, ...args].join(' ') }
  }

  if (lower.startsWith('--bind=')) {
    const prefix = cleaned.slice(verb.indexOf('=') + 1)
    if (prefix === '') return { kind: 'bind-missing-prefix' }
    return args.length === 0 ? { kind: 'bind', prefix } : { kind: 'bind-invalid' }
  }

  return { kind: 'none' }
}

/** Short alias for command parsing. */
export const parseLocusCommand = parseLocusControlCommand
/** Compatibility alias for parent integration. */
export const parseControlCommand = parseLocusControlCommand

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
  if (state === 'legacy') return state
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
 * can be bootstrapped only by a global allowlist sender.  Retired and legacy
 * endpoints never fall through to a new/default locus.
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
    return {
      admit: false,
      reason: extracted.reason === 'ambiguous-thread' ? 'ambiguous-thread' : 'invalid-endpoint',
    }
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

  let duplicate: boolean
  try {
    duplicate = context.isDuplicate(event.message_id)
  } catch {
    return { admit: false, reason: 'dedup-unavailable', endpoint }
  }
  if (duplicate) return { admit: false, reason: 'duplicate', endpoint }

  const createdAt = Number(event.create_time ?? '0')
  if (Number.isFinite(createdAt) && createdAt > 0 && createdAt < context.watermark) {
    return { admit: false, reason: 'before-watermark', endpoint }
  }

  if (event.message_type !== 'text' && event.message_type !== 'post') {
    return { admit: false, reason: 'unsupported-message-type', endpoint }
  }
  const text = (event.content ?? '').trim()
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
  // control plane so a dedicated rebuild adapter can create a fresh read locus
  // without consuming any legacy parent/workspace/permission identity.
  const explicitRebuild = allowlisted && parsed.kind === 'bind'
  if (authorization === 'retired' && !explicitRebuild) {
    return { admit: false, reason: 'retired-endpoint', endpoint, authorization }
  }
  if (authorization === 'legacy' && !explicitRebuild) {
    return { admit: false, reason: 'legacy-endpoint', endpoint, authorization }
  }

  // Only a group with an explicitly authorized locus can grant ordinary
  // non-allowlisted member questions.  P2P conversations remain allowlist
  // scoped because there is no group membership authorization to inherit.
  const canAskAsGroupMember = event.chat_type === 'group' && authorization === 'authorized'
  if (!allowlisted && !canAskAsGroupMember) {
    return { admit: false, reason: 'not-allowed-sender', endpoint, authorization }
  }

  const admission: LocusAdmission = {
    admit: true,
    endpoint,
    text,
    senderId,
    authorization,
    needsInitialization: authorization === 'uninitialized' || authorizationLookup.needsInitialization,
    ...(isControl ? { command: parsed } : {}),
  }
  return admission
}

/** Alias used by channel adapters that call the operation "inbound". */
export const admitLocusInboundEvent = admitLocusEvent
/** Alias used by integrations that call an event a message. */
export const admitLocusMessage = admitLocusEvent

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
