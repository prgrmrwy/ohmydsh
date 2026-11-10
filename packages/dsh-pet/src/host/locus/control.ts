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
import { PetError } from '../errors.js'
import type { PetErrorCode } from '../../wire.js'
import {
  isLocusControllerErrorCode,
  LocusControllerError,
  shortLocusSessionId,
  type EnsureGroupResult,
  type EnsureTopicResult,
  type LocusEndpoint,
} from './controller.js'
import { LOCUS_COMMAND_TABLE } from './admission.js'
import { LOCUS_WRITE_ENABLED, LOCUS_WRITE_DISABLED_DIAGNOSTIC } from './policy-verification.js'
import type { LocusAccessModeV20 } from './contract-v20.js'

/** Ask-scope disclosure for document entries (D7); kept in sync with doc egress. */
export const DOC_ASK_SCOPE_DISCLOSURE = '本文档的评论者均可向我提问；只有 allowlist 成员能控制'

/**
 * Sharing-scope statement appended to every successful `/bind` receipt (D3):
 * binding authorizes the entry to get answers that quote the work session, and
 * `/unbind` withdraws that.
 */
export const LOCUS_BIND_SHARING_DISCLOSURE =
  '本入口的提问可能得到引用该工作会话对话内容的答复；/unbind 可撤销。'

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
 * Cheap id-only prefilter for Host session enumeration.
 *
 * Resolving a candidate cold-inspects its whole Session log, so a Host must
 * narrow by id BEFORE resolving. Resolving every accounted session first and
 * filtering afterwards decompressed the entire session store in one burst and
 * OOM-crashed the Host on a single `/bind`. Uses the same comparison as
 * {@link resolveLocusBindPrefix}, so it can never drop a session that the
 * authoritative resolution would have matched.
 *
 * @param sessionId - Raw session id from a Workspace membership list.
 * @param prefix - The `/bind` prefix as typed.
 * @returns whether the id can possibly satisfy the prefix.
 */
export function locusSessionIdMatchesPrefix(sessionId: string, prefix: string): boolean {
  const needle = prefix.trim().toLowerCase()
  if (needle.length < MIN_LOCUS_BIND_PREFIX_LENGTH) return false
  return comparableSessionId(sessionId).startsWith(needle)
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
}

export interface LocusExitMutationPort {
  /** Stop the exact current row (idle only, D7); refuses with `LOCUS_BUSY` otherwise. */
  unbindCurrent(input: {
    readonly endpoint: LocusEndpoint
    readonly actorId: string
  }): PromiseLike<{ readonly state: 'stopped' }> | { readonly state: 'stopped' }
}

/** `/access` (D8): the change applies and is verified on the NEXT assembly, never now. */
export interface LocusAccessMutationPort {
  setAccessMode(input: {
    readonly endpoint: LocusEndpoint
    readonly actorId: string
    readonly mode: LocusAccessModeV20
  }): PromiseLike<unknown> | unknown
}

export interface CreateLocusControlDispatcherOptions {
  readonly allowOpenIds: () => readonly string[]
  /**
   * List bind candidates. `prefix` is the already length-checked `/bind`
   * prefix; a Host whose enumeration is expensive (cold session inspection)
   * should narrow by it before resolving. The result is still re-filtered by
   * {@link resolveLocusBindPrefix}, so a Host may ignore it.
   */
  readonly listSessions: (prefix: string) =>
    | PromiseLike<readonly LocusBindableSession[]>
    | readonly LocusBindableSession[]
  readonly bind: LocusBindMutationPort
  readonly exit: LocusExitMutationPort
  readonly access?: LocusAccessMutationPort
  /** Global write switch; full access is refused when it is off, read stays allowed. */
  readonly writeEnabled?: () => boolean
  /** Reads the real platform chat name. Failure/absence must stay absent. */
  readonly chatName?: (chatId: string) => PromiseLike<string | undefined> | string | undefined
  /**
   * Local diagnostic sink for failures no receipt mapping covers. Receives a
   * single line carrying only a defined reason code or `unrecognized`; never an
   * exception message, class name, stack or cause (D5).
   */
  readonly log?: (message: string) => void
}

export const LOCUS_EXPLICIT_PARENT_CONFLICT_TEXT =
  '该群已由其它会话跟进，不能在这里改绑；原会话归档后可在本入口 /bind 新会话，或在管理面「改绑到其他会话」。'
export const LOCUS_ACCESS_APPLIED_TEXT = '已更新，下次唤醒时应用并核验；核验失败将拒绝服务。'
export const LOCUS_DEPRECATED_COMMAND_TEXT = '该命令已不再改变状态，请改用 /access read|full。'

function endpointFromRequest(request: LocusControlDispatchRequest): LocusEndpoint {
  return {
    chatId: request.endpoint.chatId,
    ...(request.endpoint.threadId === undefined ? {} : { threadId: request.endpoint.threadId }),
  }
}

function failure(reason: string, text: string): LocusControlDispatchResult {
  return { ok: false, reason, text }
}

/**
 * Every {@link PetErrorCode}. A `Record` over the union keeps the table total:
 * adding a code to the wire type without listing it here fails type checking.
 */
const PET_ERROR_CODES: Readonly<Record<PetErrorCode, true>> = {
  PET_DEGRADED: true,
  INVALID_REQUEST: true,
  UNKNOWN_CAPABILITY: true,
  CAPABILITY_UNAVAILABLE: true,
  CONTEXT_REQUIRED: true,
  SOURCE_NOT_FOUND: true,
  TASK_NOT_FOUND: true,
  TASK_ARCHIVED: true,
  INVOCATION_NOT_FOUND: true,
  NO_CURRENT_INVOCATION: true,
  AMBIGUOUS_CURRENT_INVOCATION: true,
  NOT_A_PET_SESSION: true,
  REVISION_CONFLICT: true,
  SKILL_NOT_FOUND: true,
  SKILL_DISABLED: true,
  SKILL_DIGEST_MISMATCH: true,
  SKILL_IMPORT_REJECTED: true,
  INVALID_EXPRESSION: true,
  EXPRESSION_FETCH_FAILED: true,
  PROJECTION_DRIFT: true,
  WORKSPACE_UNHEALTHY: true,
  MODEL_UNAVAILABLE: true,
  BINDING_INVALID: true,
  ARCHIVE_BLOCKED: true,
  LOCUS_UNAVAILABLE: true,
  LOCUS_NOT_FOUND: true,
  LOCUS_BUSY: true,
  LOCUS_CONFLICT: true,
  LOCUS_PERMISSION_DENIED: true,
  WRITE_UNSUPPORTED: true,
  LOCUS_INVALID: true,
  LOCUS_STOPPED: true,
  COLLABORATION_UNAVAILABLE: true,
  COLLABORATION_REVISION_CONFLICT: true,
  INTERNAL: true,
}

/**
 * The only thing the fallback diagnostic may carry: a reason code the error
 * type itself defines, else `unrecognized`. A plain Error's `code` is
 * attacker/upstream controlled text, so it is never trusted.
 */
function diagnosticCode(error: unknown): string {
  if (error instanceof LocusControllerError && isLocusControllerErrorCode(error.code)) return error.code
  if (error instanceof PetError && Object.hasOwn(PET_ERROR_CODES, error.code)) return error.code
  return 'unrecognized'
}

/** The receipt for a failure with a stable, mapped reason; `undefined` when none applies. */
function mappedControlError(error: unknown): LocusControlDispatchResult | undefined {
  const code = (error as { code?: unknown } | undefined)?.code
  if (code === 'LOCUS_BUSY') {
    return failure('busy', '当前入口仍有执行中或排队消息，请稍后重试。')
  }
  if (code === 'EXPLICIT_PARENT_CONFLICT') {
    return failure('explicit-source-locked', LOCUS_EXPLICIT_PARENT_CONFLICT_TEXT)
  }
  if (code === 'GROUP_UNAVAILABLE' || code === 'TOPIC_UNAVAILABLE') {
    return failure('stopped', '当前入口已停止；在该入口内对同一个会话重新 /bind 即可重新启用。')
  }
  if (code === 'SOURCE_ARCHIVED') {
    return failure('source-archived', '来源会话已归档；可在本入口 /bind 新会话 id 前缀改绑，或在管理面改绑。')
  }
  if (code === 'LOCUS_NOT_FOUND') {
    return failure('not-found', '当前入口不存在或已失效。')
  }
  if (code === 'LOCUS_CONFLICT') {
    return failure('conflict', '入口已变化，请刷新后重试。')
  }
  if (code === 'INVALID_REQUEST') {
    return failure('access-invalid-state', '当前入口已停止或不可用，无法变更访问模式；重新启用后再试。')
  }
  if (code === 'LOCUS_MAIN_UNAVAILABLE') {
    return failure('locus-main-unavailable', '该来源会话的 locus 主会话不可用，本次未绑定。再发一次 /bind 会为它新建主会话并迁移入口。')
  }
  if (code === 'PARENT_NOT_FOUND') {
    return failure('parent-not-found', '指定的工作会话当前不可用（不存在、已归档或无法读取），未绑定。请确认会话后重新 /bind。')
  }
  if (code === 'PROVISIONING_FAILED') {
    return failure('provisioning-failed', '入口建立失败，未发布任何关联。请检查后重新 /bind；仍失败请查看 Host 日志。')
  }
  if (code === 'DEFAULT_WORKSPACE_UNAVAILABLE') {
    return failure('default-workspace-unavailable', '默认工作区不可用，无法自动创建工作会话。请在 DSH 中配置默认工作区，或用 /bind 指定已有会话。')
  }
  if (code === 'CAPABILITY_UNAVAILABLE') {
    return failure('capability-unavailable', '当前 Host 未启用建立入口所需的能力（协作空间或飞书操作端口），未执行任何操作。请检查 dsh-pet 配置。')
  }
  // The only PARENT_NOT_ALLOWED a control command can reach is "the prefix
  // resolved to a child session", which the spec requires to read exactly like
  // no match.
  if (error instanceof LocusControllerError && error.code === 'PARENT_NOT_ALLOWED') {
    return failure('prefix-unresolved', LOCUS_BIND_UNRESOLVED_TEXT)
  }
  return undefined
}

function safeControlError(
  error: unknown,
  commandKind: string,
  log: ((message: string) => void) | undefined,
): LocusControlDispatchResult {
  const mapped = mappedControlError(error)
  // A whole-W migration was committed before the entry failed (D6): say so, then
  // give the same stable reason. Retrying `/bind` reuses the new M.
  const migrated = (error as { migrationCommitted?: unknown } | null | undefined)?.migrationCommitted
  if (migrated !== undefined && migrated !== null) {
    const reason = mapped ?? failure('control-failed', '控制命令执行失败。')
    return { ...reason, text: `迁移已完成：该会话名下的入口已迁移到新的 locus 主会话；但本入口未绑定。${reason.text ?? ''}重新 /bind 会复用新的主会话，不会再次迁移。` }
  }
  if (mapped !== undefined) return mapped
  try {
    log?.(`locus control ${commandKind} failed: ${diagnosticCode(error)}`)
  } catch {
    // A broken diagnostic sink must never change the receipt.
  }
  return failure('control-failed', '控制命令执行失败，请稍后重试。')
}

function bindReceipt(
  session: LocusBindableSession,
  result: EnsureGroupResult | EnsureTopicResult,
  chatName: string | undefined,
): string {
  const isDoc = result.locus.endpoint.chatId.startsWith('doc:')
  const named = chatName !== undefined && chatName.trim() !== ''
  const place = !named ? '当前入口' : isDoc ? `文档「${chatName.trim()}」` : `群「${chatName.trim()}」`
  const source = locusSessionReceiptLabel(session)
  // The W's M was unavailable and `/bind` migrated the whole W first (D6).
  const migrated = result.migration === undefined
    ? ''
    : result.migration.chats > 0
      ? `已把该会话名下的其它入口（${result.migration.chats} 个群）迁移到新的 locus 主会话。`
      : '已为该会话新建 locus 主会话。'
  // A document's /bind always restates who may ask (pet-locus-doc-comments D7).
  const disclosure = (isDoc ? `\n${DOC_ASK_SCOPE_DISCLOSURE}` : '') + `\n${LOCUS_BIND_SHARING_DISCLOSURE}`
  if (result.rebound === true) {
    return `${place}已改绑到主会话 ${source}（原来源会话已归档）；下一条消息会创建新的只读子会话。${disclosure}`
  }
  if (result.reenabled === true) {
    return `${place}已重新启用，仍绑定主会话 ${source}；下一条消息会创建新的只读子会话。${migrated}${disclosure}`
  }
  if (result.reused) {
    return `${place}已绑定主会话 ${source}，本次未重复创建；当前访问模式见 /access。${migrated}${disclosure}`
  }
  return `${place}已绑定主会话 ${source}；已创建新的只读子会话。${migrated}${disclosure}`
}

/**
 * Build a command dispatcher that never creates a Delivery or invokes model
 * work. External session/Lark/persistence effects remain explicit injected
 * ports, so incomplete Hosts fail before being presented as wired.
 */
export function createLocusControlDispatcher(
  options: CreateLocusControlDispatcherOptions,
): LocusControlDispatchPort {
  const writeEnabled = options.writeEnabled ?? (() => LOCUS_WRITE_ENABLED)
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
            // Reject a short prefix before enumerating anything.
            if (command.prefix.trim().length < MIN_LOCUS_BIND_PREFIX_LENGTH) {
              return failure('prefix-too-short', '会话 id 前缀太短，请至少提供 6 位。')
            }
            const sessions = await Promise.resolve(options.listSessions(command.prefix))
            const resolution = resolveLocusBindPrefix(command.prefix, sessions)
            if (!resolution.resolved) {
              return resolution.reason === 'too-short'
                ? failure('prefix-too-short', '会话 id 前缀太短，请至少提供 6 位。')
                : failure('prefix-unresolved', LOCUS_BIND_UNRESOLVED_TEXT)
            }
            const rawName = await Promise.resolve(options.chatName?.(endpoint.chatId)).catch(() => undefined)
            const chatName = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : undefined
            const result = await options.bind.bind({
              endpoint,
              parentSessionId: resolution.session.id,
              ...(chatName === undefined ? {} : { chatName }),
              actorId: request.senderId,
            })
            return { ok: true, text: bindReceipt(resolution.session, result, chatName) }
          }
          case 'unbind': {
            const result = await options.exit.unbindCurrent({ endpoint, actorId: request.senderId })
            if (result.state !== 'stopped') return failure('control-failed', '解绑未形成停止标记，已拒绝报告成功。')
            return {
              ok: true,
              text: '已停止当前入口；既有会话与历史保留，普通 @ 不会自动恢复，在本入口对同一个会话重新 /bind 即可重新启用。',
            }
          }
          case 'access': {
            // Refuse a grant at the door when the global switch is off; going
            // back to read-only is always allowed.
            if (command.mode === 'danger-full-access' && !writeEnabled()) {
              return failure('access-full-disabled', LOCUS_WRITE_DISABLED_DIAGNOSTIC)
            }
            if (options.access === undefined) {
              return failure('access-unavailable', '当前入口暂不支持访问模式变更。')
            }
            const changed = await options.access.setAccessMode({ endpoint, actorId: request.senderId, mode: command.mode })
            // The mutation owns the wording (it adds the full-access disclosure); use it verbatim.
            const receipt = (changed as { receipt?: unknown } | undefined)?.receipt
            return { ok: true, text: typeof receipt === 'string' && receipt !== '' ? receipt : LOCUS_ACCESS_APPLIED_TEXT }
          }
          case 'help':
            return { ok: true, text: locusHelpText() }
          case 'deprecated-tier':
            return failure('deprecated-command', LOCUS_DEPRECATED_COMMAND_TEXT)
          case 'bind-missing-prefix':
          case 'bind-invalid':
          case 'access-missing-mode':
          case 'access-invalid':
          case 'unbind-invalid':
            return failure('invalid-command', '控制命令格式无效。')
        }
      } catch (error) {
        return safeControlError(error, command.kind, options.log)
      }
      return failure('invalid-command', '控制命令格式无效。')
    },
  }
}

/** The help receipt, generated from the parser's own command table. */
export function locusHelpText(): string {
  const lines = LOCUS_COMMAND_TABLE.map(entry => `${entry.usage} — ${entry.description}`)
  const aliases = LOCUS_COMMAND_TABLE.map(entry => entry.verbs.join(' ')).join(' | ')
  return ['可用命令（@我 后发送；仅 allowlist 成员可用）：', ...lines, `写法：${aliases}`].join('\n')
}
