/**
 * Group/topic hierarchy completion and main-session resolution.
 *
 * A Feishu entry is either a chat or a topic inside a chat. A topic locus is
 * structurally owned by its chat-level locus, so a topic's first message has
 * to complete the group level first. This module owns the ORDER in which that
 * happens, and the invariants that make the order unobservable:
 *
 * - `ensureGroup(G)` then `ensureTopic(G,T)` yields the same group main
 *   session as `ensureTopic(G,T)` alone;
 * - two topics entering concurrently create ONE automatic group main session;
 * - an explicitly bound topic does not promote its own source to the group
 *   default;
 * - locks are taken group-before-endpoint, always in that order, so two
 *   entries of the same chat cannot deadlock against each other.
 *
 * What it refuses to do is as important:
 *
 * - an existing entry always wins; a changed default workspace or group source
 *   never rewrites the parent of a locus that already exists;
 * - an explicitly INVALID group is not the same as a missing one — it is
 *   diagnosed, never silently replaced by a fresh default-workspace identity;
 * - nothing is published until the child is prepared and verified, so a
 *   half-established hierarchy is never addressable.
 *
 * External effects are injected. This module decides order and identity; it
 * creates no session, group, or child itself.
 */

import { endpointKeyOf, type LocusEndpoint } from './aggregate.js'

/** The chat-level structure a topic inherits from. */
export interface GroupContext {
  readonly chatId: string
  /** The chat-level main session every topic of this chat inherits by default. */
  readonly mainSessionId: string
  readonly workspaceId: string
  /** How this group's main session came to exist. */
  readonly source: 'auto' | 'explicit' | 'qa-created'
  /** Missing means active for compatibility with records written before markers. */
  readonly state?: 'active' | 'invalid' | 'stopped' | 'retired'
}

/** A resolved parent for one endpoint, plus where it came from. */
export interface ResolvedParent {
  readonly mainSessionId: string
  readonly workspaceId: string
  /**
   * `inherited` means the group default was used. A topic that resolves this
   * way must not write its parent back as the group default.
   */
  readonly origin: 'inherited' | 'explicit' | 'group-auto'
}

/** Why a hierarchy could not be completed. */
export type HierarchyRefusal =
  /** The chat-level structure exists but is explicitly invalid. */
  | 'group-invalid'
  /** Owner exit marker: new topics must not auto-complete through it. */
  | 'group-stopped'
  /** Retired group history also needs explicit owner rebuild. */
  | 'group-retired'
  /** No default workspace is configured, so no automatic main may be created. */
  | 'default-workspace-unavailable'
  /** The Host cannot create a main session for a new chat. */
  | 'group-provisioning-unavailable'
  /** An explicit source was requested but could not be resolved. */
  | 'explicit-source-unresolved'

export class HierarchyError extends Error {
  override readonly name = 'HierarchyError'

  constructor(readonly reason: HierarchyRefusal, message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

/** Durable reads and writes for the chat-level structure. */
export interface GroupContextStore {
  /**
   * The chat-level structure, or `undefined` when this chat has none.
   *
   * Returning invalid/stopped/retired markers is required: an owner exit or a
   * proven failure is not "never created" and must not auto-create a new main.
   * `invalid` remains accepted for the first staged adapter.
   */
  find(chatId: string): (GroupContext & { readonly invalid?: boolean }) | undefined
  /** Persist a newly created chat-level structure. */
  put(context: GroupContext): Promise<void>
}

/** Creates the external resources a chat-level structure needs. */
export interface GroupProvisioningPort {
  /**
   * Create the automatic main session for one chat.
   *
   * One per CHAT, never one per workspace: two chats in the same default
   * workspace must not share a main session, or their collaboration contexts
   * would merge.
   */
  createGroupMain(input: {
    readonly chatId: string
    readonly workspaceId: string
    readonly signal: AbortSignal
  }): Promise<{ readonly mainSessionId: string }>
}

export interface HierarchyPorts {
  readonly groups: GroupContextStore
  /** Absent keeps automatic group creation unavailable. */
  readonly provisioning?: GroupProvisioningPort
  /** The configured default workspace for automatic main sessions. */
  readonly defaultWorkspaceId?: () => string | undefined
  /** Resolve an explicitly requested main session, when one was named. */
  readonly resolveExplicit?: (
    sessionId: string,
  ) => Promise<{ readonly workspaceId: string } | undefined> | { readonly workspaceId: string } | undefined
  readonly log?: (reason: HierarchyRefusal) => void
}

/** One request to complete a hierarchy and resolve a parent. */
export interface HierarchyRequest {
  readonly endpoint: LocusEndpoint
  /**
   * An explicitly requested main session, from `/bind` or the owner panel.
   * When present it wins for THIS endpoint only.
   */
  readonly explicitMainSessionId?: string
  readonly signal: AbortSignal
}

/** Result of completing one hierarchy. */
export interface HierarchyResult {
  /** The chat-level structure, now guaranteed to exist. */
  readonly group: GroupContext
  readonly parent: ResolvedParent
  /** Whether the chat-level structure was created by this call. */
  readonly createdGroup: boolean
}

/**
 * Serialize work per key so concurrent first-entries collapse into one.
 *
 * Group before endpoint, always: a fixed order is what keeps two entries of
 * the same chat from waiting on each other's locks in opposite directions.
 */
class KeyedQueue {
  private readonly chains = new Map<string, Promise<unknown>>()

  run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve()
    const result = previous.then(job, job)
    // Keep the chain settled so one rejection cannot poison the queue.
    this.chains.set(key, result.then(() => undefined, () => undefined))
    return result
  }
}

/**
 * Create the hierarchy completion service.
 * @param ports - durable group store plus the optional provisioning seams.
 * @returns `ensure`, which completes the group level and resolves the parent.
 */
export function createLocusHierarchy(ports: HierarchyPorts): {
  ensure(request: HierarchyRequest): Promise<HierarchyResult>
} {
  const queue = new KeyedQueue()

  const refuse = (reason: HierarchyRefusal, message: string): never => {
    ports.log?.(reason)
    throw new HierarchyError(reason, message)
  }

  /** Complete the chat-level structure, creating it at most once. */
  const ensureGroup = async (
    chatId: string,
    signal: AbortSignal,
    explicit: { readonly mainSessionId: string; readonly workspaceId: string } | undefined,
  ): Promise<{ group: GroupContext; created: boolean }> =>
    // The group lock is taken FIRST and released only after the structure is
    // durable, so two topics entering together see one winner.
    queue.run(`group:${chatId}`, async () => {
      const existing = ports.groups.find(chatId)
      if (existing !== undefined) {
        const state = existing.invalid === true ? 'invalid' : existing.state ?? 'active'
        if (state !== 'active') {
          // An unavailable group is a diagnosis/owner marker, not a gap:
          // replacing it with a fresh default-workspace identity would revive
          // an endpoint the owner explicitly stopped or has not repaired.
          return refuse(
            state === 'stopped'
              ? 'group-stopped'
              : state === 'retired'
                ? 'group-retired'
                : 'group-invalid',
            `Chat ${chatId} has a ${state} collaboration structure and must be rebuilt by its owner.`,
          )
        }
        // An existing structure always wins. A changed default workspace or a
        // newly requested source never rewrites it.
        return { group: existing, created: false }
      }

      // A `/bind` naming an explicit source establishes the group directly,
      // instead of creating an automatic main that would be discarded at once.
      if (explicit !== undefined) {
        const group: GroupContext = {
          chatId,
          mainSessionId: explicit.mainSessionId,
          workspaceId: explicit.workspaceId,
          source: 'explicit',
        }
        await ports.groups.put(group)
        return { group, created: true }
      }

      const workspaceId = ports.defaultWorkspaceId?.()
      if (workspaceId === undefined || workspaceId.trim() === '') {
        return refuse(
          'default-workspace-unavailable',
          'No default workspace is configured, so an automatic main session cannot be created.',
        )
      }
      const provisioning = ports.provisioning
      if (provisioning === undefined) {
        return refuse(
          'group-provisioning-unavailable',
          'This Host cannot create an automatic main session for a new chat.',
        )
      }
      const created = await provisioning.createGroupMain({ chatId, workspaceId, signal })
      const group: GroupContext = {
        chatId,
        mainSessionId: created.mainSessionId,
        workspaceId,
        source: 'auto',
      }
      await ports.groups.put(group)
      return { group, created: true }
    })

  return {
    async ensure(request) {
      const { chatId } = request.endpoint
      let explicit: { readonly mainSessionId: string; readonly workspaceId: string } | undefined
      if (request.explicitMainSessionId !== undefined) {
        const resolved = await ports.resolveExplicit?.(request.explicitMainSessionId)
        if (resolved === undefined) {
          return refuse(
            'explicit-source-unresolved',
            'The requested main session could not be resolved.',
          )
        }
        explicit = {
          mainSessionId: request.explicitMainSessionId,
          workspaceId: resolved.workspaceId,
        }
      }

      const isTopic = request.endpoint.threadId !== undefined
      // A topic completes its group level first. For a chat-level entry this
      // IS the group level, so the same call covers both.
      const { group, created } = await ensureGroup(
        chatId,
        request.signal,
        // An explicit source establishes the group only when the entry itself
        // is the chat. An explicitly bound TOPIC must not promote its own
        // source to the group default.
        isTopic ? undefined : explicit,
      )

      // Endpoint-level resolution runs inside the endpoint lock, taken after
      // the group lock in this fixed order.
      return queue.run(`endpoint:${endpointKeyOf(request.endpoint)}`, async () => {
        if (explicit !== undefined) {
          return {
            group,
            parent: {
              mainSessionId: explicit.mainSessionId,
              workspaceId: explicit.workspaceId,
              origin: 'explicit' as const,
            },
            createdGroup: created,
          }
        }
        return {
          group,
          parent: {
            mainSessionId: group.mainSessionId,
            workspaceId: group.workspaceId,
            // A topic inheriting the group default is recorded as such, so it
            // is never mistaken for an explicit choice later.
            origin: isTopic ? ('inherited' as const) : ('group-auto' as const),
          },
          createdGroup: created,
        }
      })
    },
  }
}
