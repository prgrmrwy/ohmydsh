/**
 * The narrow view Pet takes of DSH's subagent seam, plus its optional
 * acquisition.
 *
 * Pet reaches four host capabilities for the QA group: fork a continuable
 * child from a live parent Agent, queue a host-authored message as one child
 * turn, resume a parent that is no longer resident, and observe a child
 * settling. All four are typed HERE rather than imported wholesale so the
 * plugin keeps compiling against a host that has none of them — the QA action
 * then probes as unavailable instead of preventing Pet from loading at all.
 *
 * The shapes mirror `@deepseek-ai/dsh-subagent` 0.1.2 as MEASURED by the
 * spike (`spike/qa-subagent/FINDINGS.md`), not as guessed from names:
 *
 * - `startContinuable` needs an exact live parent `Agent` object, not an id.
 * - the host delivery entry point is symbol-keyed by the target's internal
 *   `deliverSubagentPrompt` symbol and reached through the package's `internal` subpath.
 * - resolving either only means the child's inbox ACCEPTED the message; it
 *   says nothing about the turn running, finishing, or reaching persistence.
 */

import type { Agent, AgentHandle, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionId as BrandedSessionId } from '@deepseek-ai/dsh-session'
import type { SubagentListEntry, ContinuableStart, ContinuableStartSpec } from '@deepseek-ai/dsh-subagent'

/** Public target Agent identity; the Session is intentionally not assumed. */
export type LiveAgentLike = Agent

/** The `ctx.agents` operations the QA path needs. */
export interface AgentsPortLike {
  /** Return the live Agent for an exact durable identity. */
  get(sessionId: BrandedSessionId): LiveAgentLike | undefined
  /** Resume persisted state and return the owned live Agent handle. */
  resume(options: ResumeAgentOptions): Promise<AgentHandle>
}

/** One entry of the child listing, as the seam projects it. */
export type SubagentChildEntry = Extract<SubagentListEntry, { readonly kind: 'child' }>


/** The `ctx.subagents` operations the QA path needs. */
export interface SubagentsPortLike {
  /**
   * Establish one durable continuable child and deliver its first prompt.
   * @param spec - Provider, label, optional reserved child id, and request.
   * @returns the durable child id.
   */
  startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>
  /**
   * Release selected resident children of one exact live parent.
   *
   * Used for rollback: a child created for a QA group whose later steps
   * failed must not stay resident.
   * @param parent - Exact live parent.
   * @param childIds - Children to release.
   */
  drainContinuableChildren(parent: LiveAgentLike, childIds: readonly BrandedSessionId[]): Promise<void>
  /**
   * Enumerate a parent's direct children.
   * @param parentSessionId - Parent session.
   * @param signal - Cancellation.
   */
  listChildren(parentSessionId: BrandedSessionId, signal?: AbortSignal): Promise<SubagentChildEntry[]>
}

/**
 * Queue one host-authored message as a distinct child turn.
 *
 * Kept as a function type rather than a method on {@link SubagentsPortLike}
 * because the real entry point is symbol-keyed and lives on the `internal`
 * subpath: binding it once at acquisition keeps that detail out of every
 * call site.
 */
export type QueueHostPrompt = (
  parent: LiveAgentLike,
  childId: BrandedSessionId,
  text: string,
  signal: AbortSignal,
) => Promise<MessageId>

/** Everything the QA path needs from the host, once proven present. */
export interface SubagentSeam {
  readonly agents: AgentsPortLike
  readonly subagents: SubagentsPortLike
  readonly queuePrompt: QueueHostPrompt
  /** Subscribe to child settlement; returns a disposer. */
  readonly onChildSettled: (
    listener: (info: { id: string; stopReason?: string }) => void,
  ) => () => void
}

/** Why the seam could not be acquired, for the disabled-action reason. */
export type SeamDiagnostic = string

/** Outcome of probing the host for QA support. */
export type SeamProbe =
  | { readonly available: true; readonly seam: SubagentSeam }
  | { readonly available: false; readonly diagnostic: SeamDiagnostic }

/** Provider name the fork backend registers under by default. */
export const FORK_PROVIDER = 'fork'

/** Process-stable symbol the host queue entry point is keyed by. */
const DELIVER_PROMPT_SYMBOL = Symbol.for('dsh.subagent.deliverPrompt')

/** The DSH context surface this module probes, all of it optional. */
export interface HostContextLike {
  get?(name: string): unknown
  on?(event: string, listener: (...args: unknown[]) => void): () => void
}

/**
 * Probe a DSH context for the QA capabilities and bind them.
 *
 * Reads services through `ctx.get` rather than declaring them as plugin
 * dependencies: a declared dependency that the host lacks would stop Pet from
 * loading entirely, which is exactly the failure mode this plugin's own
 * lifecycle contract forbids (see the `shellEnv` note in
 * `docs/notes/dsh-plugin-integration-pitfalls.md`).
 * @param ctx - The DSH context.
 * @returns the bound seam, or a diagnostic naming what is missing.
 */
export function probeSubagentSeam(ctx: HostContextLike): SeamProbe {
  const agents = ctx.get?.('agents') as AgentsPortLike | undefined
  if (agents === undefined || typeof agents.resume !== 'function') {
    return { available: false, diagnostic: '此 DSH Host 未装配 agents 服务' }
  }
  const subagents = ctx.get?.('subagents') as
    | (SubagentsPortLike & Record<symbol, unknown>)
    | undefined
  if (subagents === undefined || typeof subagents.startContinuable !== 'function') {
    return { available: false, diagnostic: '此 DSH Host 未装配 subagents 服务' }
  }
  const deliver = subagents[DELIVER_PROMPT_SYMBOL]
  if (typeof deliver !== 'function') {
    return {
      available: false,
      diagnostic: '此 DSH Host 的 subagents 服务不支持宿主消息投递（缺 deliverPrompt）',
    }
  }
  if (typeof ctx.on !== 'function') {
    return { available: false, diagnostic: '此 DSH Host 不支持事件订阅' }
  }
  const on = ctx.on.bind(ctx)

  const queuePrompt: QueueHostPrompt = async (parent, childId, text, signal) =>
    (await (deliver as (...args: unknown[]) => Promise<MessageId>).call(
      subagents,
      parent,
      childId,
      [{ type: 'text', text }],
      { kind: 'user' },
      signal,
      'queue',
    )) as MessageId

  return {
    available: true,
    seam: {
      agents,
      subagents,
      queuePrompt,
      onChildSettled: listener =>
        on('subagent/end', (...args: unknown[]) => {
          const info = args[0] as { id?: unknown; stopReason?: unknown } | undefined
          if (info === undefined || typeof info.id !== 'string') return
          listener({
            id: info.id,
            ...(typeof info.stopReason === 'string' ? { stopReason: info.stopReason } : {}),
          })
        }),
    },
  }
}

/**
 * Resolve a live parent Agent, resuming it when it is not resident.
 *
 * Every queue call needs the EXACT live parent object: the seam checks
 * lineage against it, so an id will not do. A parent that cannot be resumed
 * is a permanent condition for this binding (its session is gone), which the
 * caller turns into invalidation rather than a retry.
 * @param seam - The bound seam.
 * @param parentSessionId - Source session that owns the child.
 * @returns the live parent, or `undefined` when it cannot be made live.
 */
export async function resolveLiveParent(
  seam: SubagentSeam,
  parentSessionId: string,
): Promise<LiveAgentLike | undefined> {
  const brandedParentId = SessionId(parentSessionId)
  const resident = seam.agents.get(brandedParentId)
  if (resident !== undefined) return resident
  try {
    const handle = await seam.agents.resume({ resumeSessionId: brandedParentId })
    const resumed = handle?.agent ?? seam.agents.get(brandedParentId)
    return resumed
  } catch {
    // Archived, deleted, or persistence-less: all indistinguishable here and
    // all equally terminal for this binding.
    return undefined
  }
}
