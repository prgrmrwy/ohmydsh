/**
 * Retirement of the previous Feishu association model.
 *
 * The unified model does not migrate old bindings. Their rows stay on the
 * medium as history, but they must never route work, restore a permission, or
 * be silently replaced by a fresh default-identity locus. This module answers
 * exactly one question for an inbound endpoint:
 *
 *   is this endpoint recognisable as a RETIRED association?
 *
 * That distinction matters because the three cases need different answers:
 *
 * - an endpoint with a current unified locus  -> serve it normally;
 * - an endpoint with no association at all    -> may be established;
 * - an endpoint known to the retired model    -> refuse, and tell the owner
 *   it must be re-established explicitly.
 *
 * Collapsing the third case into the second is the failure this exists to
 * prevent: it would take over an old group under a brand-new identity without
 * the owner ever agreeing to it. Collapsing it into "unknown error" is also
 * wrong, because the owner would have no idea a rebuild is what is needed.
 *
 * The legacy store is read through an injected port and is treated as opaque
 * history: this module never writes to it, never reads a permission out of it,
 * and never derives a session or workspace identity from it.
 */

import { endpointKeyOf, type LocusEndpoint } from './aggregate.js'

/** One retired association, reduced to the only facts that may be used. */
export interface RetiredAssociation {
  /** The endpoint the old model had bound. */
  readonly endpoint: LocusEndpoint
  /**
   * Which old form it was, for the owner-facing explanation only. It carries
   * no authority: no form grants routing, permission, or session identity.
   */
  readonly form: 'qa' | 'chat'
}

/** Read-only view of the retired association store. */
export interface RetiredAssociationStore {
  /**
   * Whether this endpoint was bound by the previous model.
   *
   * A throw is treated as "cannot prove", which fails closed: an endpoint that
   * might be a retired association must not be taken over by a new one.
   */
  find(endpoint: LocusEndpoint): RetiredAssociation | undefined
}

/** What an inbound endpoint is, for retirement purposes. */
export type EndpointRetirementState =
  /** No trace in either model; establishing a locus is allowed. */
  | { readonly kind: 'unknown' }
  /** Known to the retired model; requires an explicit owner rebuild. */
  | { readonly kind: 'retired'; readonly form: 'qa' | 'chat'; readonly receipt: string }
  /** The retired store could not be consulted, so nothing may be assumed. */
  | { readonly kind: 'unproven'; readonly diagnostic: string }

/**
 * The control receipt sent to a retired endpoint.
 *
 * Deliberately says what happened, what will NOT happen, and what the owner
 * has to do. It names no session id, workspace, or other group: a group
 * receipt must not disclose identifiers of anything outside itself.
 */
export function renderRetiredEndpointReceipt(): string {
  return '这个入口来自旧版协作模型，升级后不再自动服务。'
    + '历史会话、群和消息都保留，但需要所有者显式重新建立关联后才会继续应答。'
}

/**
 * Classify one inbound endpoint against the retired association store.
 * @param endpoint - the inbound endpoint.
 * @param store - the retired store, when this Host can consult one.
 * @returns whether the endpoint is unknown, retired, or unprovable.
 */
export function classifyEndpointRetirement(
  endpoint: LocusEndpoint,
  store: RetiredAssociationStore | undefined,
): EndpointRetirementState {
  if (store === undefined) {
    // No retired store composed at all means there is nothing to take over.
    return { kind: 'unknown' }
  }
  let match: RetiredAssociation | undefined
  try {
    match = store.find(endpoint)
  } catch (error) {
    return {
      kind: 'unproven',
      diagnostic: `retired association lookup failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
  if (match === undefined) return { kind: 'unknown' }
  if (endpointKeyOf(match.endpoint) !== endpointKeyOf(endpoint)) {
    // A store that answers with another endpoint cannot be trusted to prove
    // anything about this one.
    return { kind: 'unproven', diagnostic: 'retired association lookup returned another endpoint' }
  }
  return { kind: 'retired', form: match.form, receipt: renderRetiredEndpointReceipt() }
}

/**
 * Adapt Pet's legacy chat-binding rows to the read-only retired store.
 *
 * Only the endpoint and the coarse form are projected. The legacy row's
 * workspace, session and Task fields are intentionally NOT exposed, so no
 * caller can accidentally restore an old execution identity from them.
 */
export function asRetiredAssociationStore(repository: {
  listChatBindings(): readonly {
    readonly chatId?: unknown
    readonly threadId?: unknown
    readonly kind?: unknown
  }[]
}): RetiredAssociationStore {
  return {
    find(endpoint) {
      const key = endpointKeyOf(endpoint)
      for (const row of repository.listChatBindings()) {
        if (typeof row.chatId !== 'string' || row.chatId.trim() === '') continue
        const threadId = typeof row.threadId === 'string' && row.threadId.trim() !== ''
          ? row.threadId
          : undefined
        const rowEndpoint: LocusEndpoint = threadId === undefined
          ? { chatId: row.chatId }
          : { chatId: row.chatId, threadId }
        let rowKey: string
        try {
          rowKey = endpointKeyOf(rowEndpoint)
        } catch {
          // A malformed historical row cannot describe an endpoint; skipping
          // it is safe because it also cannot be taken over.
          continue
        }
        if (rowKey !== key) continue
        return { endpoint: rowEndpoint, form: row.kind === 'qa' ? 'qa' : 'chat' }
      }
      return undefined
    },
  }
}
