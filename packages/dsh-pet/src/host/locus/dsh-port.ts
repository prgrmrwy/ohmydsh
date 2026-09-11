/**
 * Production-facing DSH adapter for the unified locus controller.
 *
 * The adapter depends only on narrow structural ports. The Host composition can
 * pass its real services, while unit tests can exercise cold persistence,
 * workspace accounting, setup ordering and ownership-bound rollback without
 * loading Cordis or a complete DSH Host.
 *
 * Deliberate safety boundaries:
 *
 * - session existence comes from `sessionController.inspect`, never from the
 *   live Agent/session registries;
 * - a session is eligible only when exactly one Workspace accounts for it;
 * - the configured default Workspace is read from Pet's durable channel row and
 *   its directory is checked at use time;
 * - a main Agent mounts the preset id snapshotted before creation, before the
 *   Agent can be published;
 * - creation flushes the renamed Session before returning it for durable locus
 *   publication;
 * - runtime cleanup retains the exact Workspace and AgentHandle capabilities
 *   returned during creation. There is intentionally no generic
 *   `releaseSession(id)`;
 * - child creation remains unavailable until the pinned runtime exposes the
 *   required idle-parent continuation patch.
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionTitle as foldDshSessionTitle } from '@deepseek-ai/dsh-session-title'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { LocusDshPort, LocusParentSession, LocusWorkspace } from './controller.js'

/** Minimal cold-inspection result consumed by this adapter. */
export interface LocusSessionInspection {
  readonly meta: {
    readonly id: SessionId
    readonly parentSession?: SessionId
  }
  readonly events: readonly SessionEvent[]
}

/** Minimal Workspace entity surface consumed by this adapter. */
export interface LocusWorkspaceEntity {
  readonly id: WorkspaceId
  readonly path: string
  readonly title?: string
  readonly sessionIds: readonly SessionId[]
  status(): Promise<'ok' | 'missing-dir'>
  attachSession(sessionId: SessionId): Promise<void>
  detachSession(sessionId: SessionId): Promise<void>
}

/** Exact creation capability retained for rollback. */
export interface LocusAgentHandle {
  readonly agent: { readonly session: Session }
  dispose(): Promise<void>
}

/** Narrow dependency face for the production adapter. */
export interface ProductionLocusDshPortDeps {
  readonly repository: {
    getChannelConfig(): { readonly defaultWorkspaceId?: string | undefined }
  }
  readonly sessionController: {
    inspect(sessionId: SessionId): Promise<LocusSessionInspection>
  }
  readonly workspaceRegistry: {
    get(workspaceId: WorkspaceId): LocusWorkspaceEntity | undefined
    list(): LocusWorkspaceEntity[]
    readonly archivedSessionIds: readonly SessionId[]
  }
  readonly agents: {
    create(options: CreateAgentOptions): Promise<LocusAgentHandle>
    /**
     * Submit the opening briefing as an ordinary follow-up turn.
     *
     * Deliberately fire-and-forget: `followup` is synchronous and void, and
     * provisioning must not block on a model round trip — the durable locus is
     * published from the creation facts, not from whatever the main replies.
     * Absent keeps creation working without a briefing.
     */
    brief?(agent: LocusAgentHandle['agent'], text: string): void
  }
  readonly agentPresets: {
    readonly defaultId: string
    mount(agentContext: Context, presetId: string): Promise<unknown>
  }
  readonly agentDefaultModel: {
    currentSelection(): AgentOptions
  }
  readonly sessions: {
    flush(session: Session): Promise<boolean>
  }
  readonly sessionTitle: {
    rename(session: Session, title: string): { readonly title: string } | Promise<{ readonly title: string }>
  }
  /**
   * Optional reviewed idle-child provisioner. It owns staging, the exact
   * continuable adapter and rollback capabilities; absent keeps child creation
   * fail closed.
   */
  readonly idleChildren?: {
    create(input: {
      readonly parentSessionId: string
      readonly workspaceId: string
      readonly locusId: string
      readonly generation: number
      readonly label: string
      readonly permission: 'read'
    }): Promise<{
      readonly childSessionId: string
      readonly commit: () => void
      readonly rollback: () => Promise<void>
    }>
  }
  /** Optional pure title-fold override for focused tests. */
  readonly foldSessionTitle?: (
    events: readonly SessionEvent[],
  ) => { readonly title: string } | undefined
  /** Injectable solely to make allocation deterministic in unit tests. */
  readonly createSessionId?: () => string
}

/** Stable error exposed while child creation is intentionally gated off. */
export class LocusDshCapabilityUnavailableError extends Error {
  override readonly name = 'LocusDshCapabilityUnavailableError'
  readonly code = 'CAPABILITY_UNAVAILABLE' as const
}

/** Facts stated to a locus main in its opening briefing. */
export interface LocusMainBriefingInput {
  /** Feishu chat this main was provisioned for. */
  readonly chatId: string
  /** Workspace the main is accounted to. */
  readonly workspaceId: string
  /** Absolute execution root of that workspace. */
  readonly workspacePath: string
  /** The durable title this main is renamed to. */
  readonly label: string
}

/**
 * Compose the locus main's opening briefing.
 *
 * This is context, not a task. The main exists to be a collaboration root —
 * the Feishu traffic is served by its child sessions — so the briefing states
 * what this session is and explicitly tells the model to acknowledge and stand
 * by rather than start work. Without that instruction a capable model reads a
 * project path plus a workspace and helpfully begins investigating, which
 * would burn a real turn and, worse, make the main look like it had opinions
 * nobody asked for.
 *
 * @param input - the identity facts to state.
 * @returns the briefing prompt text.
 */
export function composeLocusMainBriefing(input: LocusMainBriefingInput): string {
  return [
    `你是 Pet 统一 Locus 协作模型自动创建的主会话：${input.label}`,
    '',
    `- 飞书入口 chat：${input.chatId}`,
    `- 工作区：${input.workspaceId}`,
    `- 执行根：${input.workspacePath}`,
    '',
    '这条消息只是陈述上下文，让你了解自己的身份与背景，不是任务，也不需要你应答或开始任何工作。',
    '飞书侧的消息由本主会话下的专属子会话处理，不会自动回传到这里；你不需要主动分析项目、读取文件或给出结论。',
    '',
    '请只回复「了解」或「知道了」，然后保持待命（standby），等待所有者后续的显式指令。',
  ].join('\n')
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function includesSession(workspace: LocusWorkspaceEntity, sessionId: SessionId): boolean {
  return workspace.sessionIds.some(candidate => candidate === sessionId)
}

function aggregateError(error: unknown): readonly unknown[] {
  return error instanceof AggregateError ? error.errors : [error]
}

/**
 * Detach sidebar accounting and dispose the exact Agent owned by this create.
 * Both operations are always attempted; one failure never suppresses the other.
 *
 * This is runtime ownership rollback, not history deletion: current DSH has no
 * public API that erases a persisted Session log. A failure after the durability
 * checkpoint may therefore leave an ungrouped Session artifact for explicit
 * recovery/diagnosis, but this capability can never tear down an unrelated id.
 */
async function rollbackOwnedMain(
  workspace: LocusWorkspaceEntity,
  handle: LocusAgentHandle,
  sessionId: SessionId,
): Promise<void> {
  const failures: unknown[] = []
  try {
    await workspace.detachSession(sessionId)
  } catch (error) {
    failures.push(error)
  }
  try {
    await handle.dispose()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Could not completely roll back locus main session ${sessionId}`)
  }
}

/**
 * Build the production DSH port from narrow, testable Host capabilities.
 *
 * The returned object intentionally omits `releaseSession`: only a creator-held
 * rollback closure may tear down a session created by this adapter.
 */
export function createProductionLocusDshPort(
  deps: ProductionLocusDshPortDeps,
): LocusDshPort {
  const createSessionId = deps.createSessionId ?? (() => `session-${randomUUID()}`)
  const foldTitle = deps.foldSessionTitle ?? foldDshSessionTitle

  return {
    async resolveSession(sessionId): Promise<LocusParentSession | undefined> {
      const requestedId = normalized(sessionId)
      if (requestedId === undefined) return undefined
      const brandedSessionId = SessionId(requestedId)

      let inspection: LocusSessionInspection
      try {
        inspection = await deps.sessionController.inspect(brandedSessionId)
      } catch {
        // Missing, corrupt and temporarily unreadable are all unavailable to a
        // binding operation. None may fall back to another identity.
        return undefined
      }
      if (inspection.meta.id !== brandedSessionId) return undefined

      const memberships = deps.workspaceRegistry
        .list()
        .filter(workspace => includesSession(workspace, brandedSessionId))
      // Zero memberships cannot prove workspace ownership. More than one is a
      // registry invariant violation; choosing either would be unsafe.
      if (memberships.length !== 1) return undefined
      const workspace = memberships[0]
      if (workspace === undefined) return undefined

      if ((await workspace.status()) !== 'ok') return undefined

      const archived = deps.workspaceRegistry.archivedSessionIds.some(
        candidate => candidate === brandedSessionId,
      )
      const title = foldTitle(inspection.events)?.title
      return {
        id: requestedId,
        workspaceId: String(workspace.id),
        ...(title === undefined ? {} : { title }),
        ...(inspection.meta.parentSession === undefined
          ? {}
          : { parentSessionId: String(inspection.meta.parentSession) }),
        state: archived ? 'archived' : 'active',
      }
    },

    async resolveDefaultWorkspace(): Promise<LocusWorkspace | undefined> {
      const workspaceId = normalized(deps.repository.getChannelConfig().defaultWorkspaceId)
      if (workspaceId === undefined) return undefined
      const workspace = deps.workspaceRegistry.get(WorkspaceId(workspaceId))
      if (
        workspace === undefined ||
        String(workspace.id) !== workspaceId ||
        (await workspace.status()) !== 'ok'
      ) return undefined
      return { id: workspaceId, ...(workspace.title === undefined ? {} : { title: workspace.title }) }
    },

    async createMainSession(input) {
      const chatId = normalized(input.chatId)
      if (chatId === undefined) {
        throw new LocusDshCapabilityUnavailableError('Cannot create a locus main without a chat id')
      }
      const workspaceId = normalized(input.workspaceId)
      if (workspaceId === undefined) {
        throw new LocusDshCapabilityUnavailableError('Cannot create a locus main without a workspace id')
      }
      const workspace = deps.workspaceRegistry.get(WorkspaceId(workspaceId))
      if (
        workspace === undefined ||
        String(workspace.id) !== workspaceId ||
        normalized(workspace.path) === undefined ||
        (await workspace.status()) !== 'ok'
      ) {
        throw new LocusDshCapabilityUnavailableError(
          `Workspace ${workspaceId} is unavailable for locus main creation`,
        )
      }

      // Freeze mutable defaults once so header, setup and runtime selection are
      // one creation decision even if settings hot-reload during setup.
      const presetId = normalized(deps.agentPresets.defaultId)
      if (presetId === undefined) {
        throw new LocusDshCapabilityUnavailableError(
          'The Host has no default Agent preset for locus main creation',
        )
      }
      const selection = { ...deps.agentDefaultModel.currentSelection() }
      const allocatedSessionId = normalized(createSessionId())
      if (allocatedSessionId === undefined) {
        throw new Error('The locus main session id allocator returned an empty id')
      }
      const sessionId = SessionId(allocatedSessionId)

      const handle = await deps.agents.create({
        sessionId,
        meta: { cwd: workspace.path, agentPreset: presetId },
        agentOptions: selection,
        setup: async agentContext => {
          await deps.agentPresets.mount(agentContext, presetId)
        },
      })

      let title: string
      try {
        // Accounting is part of the identity proof, not a cosmetic best-effort
        // attach. Rename only after that proof is durable.
        await workspace.attachSession(sessionId)
        title = (await deps.sessionTitle.rename(handle.agent.session, input.label)).title

        // Brief the main through the ORDINARY lifecycle: an identified user
        // message through `followup`, exactly as a native client sends one.
        //
        // This is also what stops the main from looking like an unused "新会话".
        // DSH classifies a session with no logged `turn/start` as blank, and
        // blank is not cosmetic: it blanks the sidebar label, hides the
        // conversation header, and — the real hazard — makes the session
        // eligible for `connectWorkspace()` reuse, so a user pressing
        // "New Session" in this workspace could be handed the collaboration
        // root and type into it. The loop appends `turn/start` when it opens
        // the turn, BEFORE any model call, so the session leaves the blank
        // class even where the model itself is unavailable.
        deps.agents.brief?.(handle.agent, composeLocusMainBriefing({
          chatId,
          workspaceId,
          workspacePath: workspace.path,
          label: input.label,
        }))

        if (!(await deps.sessions.flush(handle.agent.session))) {
          throw new LocusDshCapabilityUnavailableError(
            `Session ${sessionId} has no durability listener, so it cannot be published as a locus main`,
          )
        }
      } catch (error) {
        try {
          await rollbackOwnedMain(workspace, handle, sessionId)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, ...aggregateError(rollbackError)],
            `Locus main session ${sessionId} provisioning failed and rollback was incomplete`,
          )
        }
        throw error
      }

      return {
        id: sessionId,
        workspaceId,
        title,
        rollback: () => rollbackOwnedMain(workspace, handle, sessionId),
      }
    },

    async createChildSession(input) {
      const idleChildren = deps.idleChildren
      if (idleChildren === undefined) {
        throw new LocusDshCapabilityUnavailableError(
          'Unified locus child creation requires the reviewed idle-continuable runtime',
        )
      }
      const created = await idleChildren.create({
        parentSessionId: input.parentSessionId,
        workspaceId: input.workspaceId,
        locusId: input.locusId,
        generation: input.generation,
        label: input.label,
        permission: input.permission,
      })
      return {
        id: created.childSessionId,
        parentSessionId: input.parentSessionId,
        workspaceId: input.workspaceId,
        commit: created.commit,
        rollback: created.rollback,
      }
    },
  }
}
