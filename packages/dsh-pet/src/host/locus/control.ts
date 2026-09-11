/**
 * Pure control-plane adapter for unified-locus Feishu commands.
 *
 * Admission remains the first boundary: only an allowlisted sender should ever
 * reach this object.  The dispatcher deliberately repeats that check so a Host
 * cannot accidentally publish a mutation seam without the command allowlist.
 * Session prefix lookup is non-enumerating, and all group-visible labels use
 * the same six-character identity shown by the Web session badge.
 */

import type {
  LocusControlCommand,
  LocusControlDispatchPort,
  LocusControlDispatchRequest,
  LocusControlDispatchResult,
} from './admission.js'
import {
  LocusControllerError,
  shortLocusSessionId,
  type EnsureGroupResult,
  type EnsureTopicResult,
  type LocusEndpoint,
} from './controller.js'

export const MIN_LOCUS_BIND_PREFIX_LENGTH = 6
export const LOCUS_BIND_UNRESOLVED_TEXT =
  '没有匹配到唯一的会话。请提供更长的会话 id 前缀后重试。'

/** A session candidate visible to the trusted Host session registry. */
export interface LocusBindableSession {
  readonly id: string
  readonly title?: string
  readonly workspaceId: string
  /** Present for a subagent; subagents cannot become another locus parent. */
  readonly parentSessionId?: string
  readonly state?: 'active' | 'archived' | 'missing'
}

export type LocusBindPrefixResolution =
  | { readonly resolved: true; readonly session: LocusBindableSession }
  | { readonly resolved: false; readonly reason: 'too-short' | 'not-unique' }

/** Prefix comparison follows the six-character session badge, case-insensitively. */
function comparableSessionId(sessionId: string): string {
  return sessionId.replace(/^(?:task|session)-/, '').toLowerCase()
}

/**
 * Resolve exactly one usable main session without exposing whether zero or
 * several candidates matched.
 */
export function resolveLocusBindPrefix(
  prefix: string,
  sessions: readonly LocusBindableSession[],
): LocusBindPrefixResolution {
  const needle = prefix.trim().toLowerCase()
  if (needle.length < MIN_LOCUS_BIND_PREFIX_LENGTH) {
    return { resolved: false, reason: 'too-short' }
  }
  const matches = sessions.filter(session =>
    session.id.trim() !== '' &&
    session.workspaceId.trim() !== '' &&
    session.parentSessionId === undefined &&
    session.state !== 'archived' &&
    session.state !== 'missing' &&
    comparableSessionId(session.id).startsWith(needle),
  )
  const match = matches.length === 1 ? matches[0] : undefined
  return match === undefined
    ? { resolved: false, reason: 'not-unique' }
    : { resolved: true, session: match }
}

/** Minimum disclosure for one main session in a group-visible receipt. */
export function locusSessionReceiptLabel(session: Pick<LocusBindableSession, 'id' | 'title'>): string {
  const title = session.title?.trim()
  const shortId = shortLocusSessionId(session.id)
  return title === undefined || title === '' ? shortId : `「${title}」（${shortId}）`
}

export interface LocusBindMutationInput {
  readonly endpoint: LocusEndpoint
  readonly parentSessionId: string
  /** Platform fact only. Unknown stays absent; this adapter never invents one. */
  readonly chatName?: string
  readonly actorId: string
}

export interface LocusBindMutationPort {
  bind(input: LocusBindMutationInput):
    | PromiseLike<EnsureGroupResult | EnsureTopicResult>
    | EnsureGroupResult
    | EnsureTopicResult
  /**
   * Explicit owner rebuild for an endpoint protected by a unified tombstone or
   * an opaque legacy endpoint marker. It must derive the new identity solely
   * from `parentSessionId`; legacy rows provide no workspace or permission.
   */
  rebuildProtected?(input: LocusBindMutationInput & {
    readonly marker: 'legacy' | 'retired'
  }): PromiseLike<EnsureGroupResult | EnsureTopicResult> | EnsureGroupResult | EnsureTopicResult
}

export interface LocusExitMutationPort {
  /** Stop the exact current endpoint generation and retain its stop marker. */
  unbindCurrent(input: {
    readonly endpoint: LocusEndpoint
    readonly actorId: string
  }): PromiseLike<{
    readonly state: 'stopped'
    readonly busy?: false
  }> | {
    readonly state: 'stopped'
    readonly busy?: false
  }
}

export interface LocusScopeMutationPort {
  setCurrentMode?(input: {
    readonly endpoint: LocusEndpoint
    readonly actorId: string
    readonly mode: 'read' | 'write'
  }): PromiseLike<{ readonly mode: 'read' | 'write' }> | { readonly mode: 'read' | 'write' }
}

export interface CreateLocusControlDispatcherOptions {
  readonly allowOpenIds: () => readonly string[]
  readonly listSessions: () =>
    | PromiseLike<readonly LocusBindableSession[]>
    | readonly LocusBindableSession[]
  readonly bind: LocusBindMutationPort
  readonly exit: LocusExitMutationPort
  readonly scope?: LocusScopeMutationPort
  /** Reads the real platform chat name. Failure/absence must stay absent. */
  readonly chatName?: (chatId: string) => PromiseLike<string | undefined> | string | undefined
}

function endpointFromRequest(request: LocusControlDispatchRequest): LocusEndpoint {
  return {
    chatId: request.endpoint.chatId,
    ...(request.endpoint.threadId === undefined ? {} : { threadId: request.endpoint.threadId }),
  }
}

function failure(reason: string, text: string): LocusControlDispatchResult {
  return { ok: false, reason, text }
}

function safeControlError(error: unknown): LocusControlDispatchResult {
  const code = (error as { code?: unknown } | undefined)?.code
  if (code === 'BUSY' || code === 'LOCUS_BUSY') {
    return failure('busy', '当前入口仍有执行中或排队消息，请稍后重试。')
  }
  if (code === 'EXPLICIT_PARENT_CONFLICT' || code === 'EXPLICIT_SOURCE_LOCKED') {
    return failure('explicit-source-locked', '当前入口已显式绑定其它主会话，请先解除后再绑定。')
  }
  if (code === 'LOCUS_STOPPED' || code === 'GROUP_UNAVAILABLE') {
    return failure('stopped', '当前入口已停止，需要所有者显式重建后才能继续。')
  }
  if (error instanceof LocusControllerError && error.code === 'PARENT_NOT_ALLOWED') {
    return failure('prefix-unresolved', LOCUS_BIND_UNRESOLVED_TEXT)
  }
  return failure('control-failed', '控制命令执行失败，请稍后重试。')
}

function bindReceipt(
  session: LocusBindableSession,
  result: EnsureGroupResult | EnsureTopicResult,
  chatName: string | undefined,
): string {
  const place = chatName === undefined || chatName.trim() === '' ? '当前入口' : `群「${chatName.trim()}」`
  const source = locusSessionReceiptLabel(session)
  if (result.reused) return `${place}已绑定主会话 ${source}，本次未重复创建；当前共享权限为 read。`
  return `${place}已绑定主会话 ${source}；已创建新的只读子会话。`
}

/**
 * Build a command dispatcher that never creates a Delivery or invokes model
 * work. External session/Lark/persistence effects remain explicit injected
 * ports, so incomplete Hosts fail before being presented as wired.
 */
export function createLocusControlDispatcher(
  options: CreateLocusControlDispatcherOptions,
): LocusControlDispatchPort {
  return {
    async dispatch(request): Promise<LocusControlDispatchResult> {
      // Defence in depth: admission already checks this, but a directly wired
      // dispatcher must not turn into a control-authority bypass.
      if (!options.allowOpenIds().includes(request.senderId)) {
        return { ok: false, reason: 'not-allowed', silent: true }
      }
      const endpoint = endpointFromRequest(request)
      const command: LocusControlCommand = request.command
      try {
        switch (command.kind) {
          case 'bind': {
            const sessions = await Promise.resolve(options.listSessions())
            const resolution = resolveLocusBindPrefix(command.prefix, sessions)
            if (!resolution.resolved) {
              return resolution.reason === 'too-short'
                ? failure('prefix-too-short', '会话 id 前缀太短，请至少提供 6 位。')
                : failure('prefix-unresolved', LOCUS_BIND_UNRESOLVED_TEXT)
            }
            const rawName = await Promise.resolve(options.chatName?.(endpoint.chatId)).catch(() => undefined)
            const chatName = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : undefined
            const mutation = {
              endpoint,
              parentSessionId: resolution.session.id,
              ...(chatName === undefined ? {} : { chatName }),
              actorId: request.senderId,
            }
            const marker = request.authorization === 'legacy' || request.authorization === 'retired'
              ? request.authorization
              : undefined
            if (marker !== undefined && options.bind.rebuildProtected === undefined) {
              return failure('rebuild-unavailable', '该旧入口需要所有者显式重建，但当前 Host 未提供安全重建能力。')
            }
            const result = marker === undefined
              ? await options.bind.bind(mutation)
              : await options.bind.rebuildProtected!({ ...mutation, marker })
            return { ok: true, text: bindReceipt(resolution.session, result, chatName) }
          }
          case 'unbind': {
            const result = await options.exit.unbindCurrent({ endpoint, actorId: request.senderId })
            if (result.state !== 'stopped') return failure('control-failed', '解绑未形成停止标记，已拒绝报告成功。')
            return {
              ok: true,
              text: '已停止当前入口；既有会话与历史保留，普通 @不会自动恢复，需所有者显式重建。',
            }
          }
          case 'scope': {
            if (options.scope?.setCurrentMode === undefined) {
              return failure('scope-unavailable', '当前入口暂不支持权限变更。')
            }
            const result = await options.scope.setCurrentMode({
              endpoint,
              actorId: request.senderId,
              mode: command.mode,
            })
            return result.mode === command.mode
              ? { ok: true, text: `当前入口共享权限已核验为 ${command.mode}。` }
              : failure('scope-not-applied', '权限变更未核验生效，已拒绝报告成功。')
          }
          case 'bind-missing-prefix':
          case 'bind-invalid':
          case 'scope-missing-mode':
          case 'scope-invalid':
          case 'unbind-invalid':
            return failure('invalid-command', '控制命令格式无效。')
        }
      } catch (error) {
        return safeControlError(error)
      }
    },
  }
}
