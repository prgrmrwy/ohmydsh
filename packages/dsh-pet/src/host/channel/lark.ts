/**
 * Bot-identity Lark calls, executed through the local `lark-cli`.
 *
 * Pet never holds Lark credentials: every call here shells out to `lark-cli`,
 * which owns the app secret and token lifecycle. Two consequences are load
 * bearing — Pet cannot leak a credential it never has, and a login that has
 * expired surfaces as a CLI failure Pet reports rather than a silent
 * misbehaviour.
 *
 * Every call runs `--as bot`. User identity would pull in the operator's own
 * visibility when reading history, and would make replies appear to come from
 * the person rather than the bot.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { PET_CLI_PROFILE, petCliArgs } from './cli.js'
import type { LocusLarkPort } from '../locus/controller.js'

const run = promisify(execFile)

export type LarkCliRunner = (
  binary: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr?: string }>

/** One historical message, reduced to what the prompt needs. */
export interface LarkHistoryMessage {
  readonly messageId: string
  readonly senderName: string
  readonly text: string
  readonly createTime: string
  /** Monotonic position within the chat, used to split before/after. */
  readonly position: number
}

/** One bot member of a chat, as reported by the member list. */
export interface LarkChatBot {
  /** Owning app id — the field that proves which app a bot belongs to. */
  readonly appId: string
  /** The bot's open_id within this tenant. */
  readonly openId: string
  readonly name: string
}

/** Non-secret bot identity proven by `auth status --verify`. */
export interface LarkBotIdentity {
  readonly appId: string
  readonly openId: string
  readonly name?: string
}

/** Non-secret current-user identity proven by the fixed profile's live auth status. */
export interface LarkUserIdentity {
  readonly appId: string
  readonly openId: string
  readonly name?: string
}

/** Safe subset of a structured lark-cli authorization error. */
export interface LarkPermissionDiagnostic {
  readonly code?: number
  readonly missingScopes: readonly string[]
  readonly consoleUrl?: string
}

/** Result of a bot identity probe; failures never guess an identity. */
export type LarkIdentityProbe =
  | { readonly kind: 'ready'; readonly identity: LarkBotIdentity }
  | { readonly kind: 'unavailable'; readonly diagnostic: string }

/** Result of a current-user identity probe; failures never trust configuration text. */
export type LarkUserIdentityProbe =
  | { readonly kind: 'ready'; readonly identity: LarkUserIdentity }
  | { readonly kind: 'unavailable'; readonly diagnostic: string }

/** Current human owner proof for a default Q&A group. */
export type LarkDefaultQaOwnerProbe =
  | { readonly kind: 'ready'; readonly ownerId: string }
  | { readonly kind: 'unavailable'; readonly diagnostic: string }

/** Result of listing bot members without collapsing permission failures. */
export type LarkChatBotsResult =
  | { readonly kind: 'ok'; readonly bots: readonly LarkChatBot[] }
  | { readonly kind: 'permission-denied'; readonly diagnostic: LarkPermissionDiagnostic }
  | { readonly kind: 'error' }

/** Bot-identity Lark operations Pet depends on. */
export interface LarkClient {
  /** Detect whether the installed CLI exposes the identity contract Pet needs. */
  cliVersion?(): Promise<{ readonly supported: boolean; readonly version?: string }>
  /**
   * Add a reaction to a message.
   * @param messageId - Target message.
   * @param emoji - Lark `emoji_type`.
   * @returns the reaction id, or `undefined` when the call failed.
   */
  addReaction(messageId: string, emoji: string): Promise<string | undefined>
  /**
   * Remove a previously added reaction.
   * @param messageId - Target message.
   * @param reactionId - Reaction id returned by {@link addReaction}.
   */
  removeReaction(messageId: string, reactionId: string): Promise<void>
  /**
   * Read recent messages of one chat.
   * @param chatId - Target chat.
   * @param limit - Maximum messages to fetch.
   * @returns the messages, newest first; empty on failure.
   */
  listMessages(chatId: string, limit: number): Promise<readonly LarkHistoryMessage[]>
  /**
   * Whether this machine's lark-cli can act as the bound bot right now.
   *
   * Checked rather than assumed: telling an agent it can read Lark when the
   * bot login has expired produces a confident, wrong plan and a failed turn.
   * @returns whether bot-identity calls are usable.
   */
  botReady(): Promise<boolean>
  /** Prove the bound bot's non-secret identity from the selected profile. */
  botIdentity?(expectedAppId: string): Promise<LarkIdentityProbe>
  /**
   * Prove the currently logged-in human from this same fixed profile.
   * Browser authentication and a configured allowlist are not identity proof.
   */
  userIdentity?(expectedAppId: string): Promise<LarkUserIdentityProbe>
  /** Prove that the current human is also explicitly present in the configured allowlist. */
  defaultQaOwner?(
    expectedAppId: string,
    allowOpenIds: readonly string[],
  ): Promise<LarkDefaultQaOwnerProbe>
  /**
   * Read a chat's display name.
   *
   * Needed because an inbound event carries only the chat id: without this a
   * route row and every prompt would identify the conversation as `oc_…`,
   * which tells a reader nothing.
   * @param chatId - Target chat.
   * @returns the name, or `undefined` when it cannot be read.
   */
  chatName(chatId: string): Promise<string | undefined>
  /**
   * List the bot members of one chat.
   *
   * The only call that ties an open_id to an app id, which makes it the proof
   * step for bot self-identification.
   * @param chatId - Target chat.
   * @returns the bot members; empty on failure.
   */
  listChatBots(chatId: string): Promise<LarkChatBotsResult | readonly LarkChatBot[]>
  /**
   * Reply to a message as the bot.
   * @param messageId - Message being replied to.
   * @param text - Reply body.
   */
  reply(messageId: string, text: string): Promise<void>
  /**
   * Reply with strict process/envelope/identifier verification.
   * Used only by caller-bound locus business replies so the child is not told
   * a message was sent when lark-cli failed softly.
   */
  replyExact?(messageId: string, text: string): Promise<void>
  /**
   * Send a control-plane receipt and report delivery failure to the caller.
   * Ordinary Agent work keeps using fail-soft {@link reply}; pairing needs to
   * know whether its post-commit acknowledgement was delivered.
   */
  replyStrict?(messageId: string, text: string): Promise<void>
  /**
   * Create a private group and invite the given users.
   *
   * NOT fail-soft, unlike the rest of this client: the QA group transaction
   * treats a failure here as a reason to roll the whole action back, so an
   * unusable result MUST raise rather than resolve to `undefined` and let a
   * binding be written against a group that does not exist.
   * @param name - Group name.
   * @param userOpenIds - Members to invite besides the bot itself.
   * @param ownerOpenId - Who owns the group. Creating as the bot defaults
   * ownership TO the bot, which would leave the human unable to rename,
   * invite, remove, or disband their own group — they would have to ask an
   * agent to do it. Pass the owner explicitly.
   * @returns the new chat id.
   * @throws when lark-cli refused or returned no chat id.
   */
  createChat(
    name: string,
    userOpenIds: readonly string[],
    ownerOpenId?: string,
  ): Promise<string>
  /**
   * Count the human members of a chat.
   *
   * Used to state the blast radius when binding an existing group: from that
   * moment every one of them can put work into a real repository through the
   * bot, and the owner should see that number at the moment they choose it.
   * Fail-soft — an unknown count omits the line rather than blocking a bind.
   * @param chatId - Target chat.
   * @returns the member count, or `undefined` when it cannot be read.
   */
  memberCount(chatId: string): Promise<number | undefined>
  /**
   * Send a standalone message to a chat as the bot.
   *
   * Distinct from {@link reply}: a notice about an invalidated QA binding has
   * no trigger message worth threading under.
   * @param chatId - Target chat.
   * @param text - Message body.
   */
  sendToChat(chatId: string, text: string): Promise<void>
}

/** How long any single lark-cli call may take. */
const CALL_TIMEOUT_MS = 20_000

interface CliJsonResult {
  readonly ok: boolean
  readonly value?: unknown
}

/**
 * Parse a CLI JSON document even when stderr prepends progress lines.
 *
 * lark-cli shortcuts may emit lines such as `[page 1] fetching...` before the
 * final structured error. Only a successfully parsed JSON suffix escapes this
 * function; progress text and raw errors are never retained.
 */
function parseCliJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Try every line boundary from the end. Pretty-printed JSON begins with a
    // `{`/`[` at a line boundary, while any earlier progress output is ignored.
    const lines = trimmed.split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const first = lines[index]?.trimStart()[0]
      if (first !== '{' && first !== '[') continue
      try {
        return JSON.parse(lines.slice(index).join('\n'))
      } catch {
        // The candidate was nested JSON or still included non-JSON output.
      }
    }
    return undefined
  }
}

/** Invoke lark-cli and retain a structured error response without raw text. */
async function callJson(
  args: readonly string[],
  binary: string,
  runner: LarkCliRunner,
): Promise<CliJsonResult> {
  let text: string | undefined
  let ok = true
  try {
    const result = await runner(binary, petCliArgs(args), {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    text = result.stdout
  } catch (error) {
    ok = false
    const failure = error as { stdout?: unknown; stderr?: unknown }
    text =
      typeof failure.stdout === 'string' && failure.stdout.trim() !== ''
        ? failure.stdout
        : typeof failure.stderr === 'string'
          ? failure.stderr
          : undefined
  }
  if (text === undefined) return { ok: false }
  const value = parseCliJson(text)
  return value === undefined ? { ok: false } : { ok, value }
}

/** Read the usual `{ok,data}` lark-cli envelope. */
async function callCli(
  args: readonly string[],
  binary: string,
  runner: LarkCliRunner,
): Promise<unknown> {
  const result = await callJson(args, binary, runner)
  if (!result.ok) return undefined
  const parsed = result.value as { ok?: boolean; data?: unknown } | undefined
  return parsed?.ok === true ? parsed.data : undefined
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/**
 * Read a successful CLI process and its successful Lark envelope.
 *
 * This is intentionally separate from {@link callCli}.  Most channel
 * decoration is fail-soft, but a locus provisioning/control transaction must
 * never mistake an exit failure, malformed JSON, or `{ok:false}` for success.
 */
function strictEnvelopeData(result: CliJsonResult, operation: string): unknown {
  if (!result.ok) throw new Error(`${operation}: lark-cli process failed`)
  const envelope = recordOf(result.value)
  if (envelope?.['ok'] !== true) throw new Error(`${operation}: lark-cli envelope was not ok`)
  return envelope['data']
}

function requireInput(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${field} must be a non-empty string`)
  return normalized
}

function requireOpenId(value: string, field: string): string {
  const normalized = requireInput(value, field)
  if (!/^ou_[A-Za-z0-9]+$/.test(normalized)) throw new Error(`${field} must be an open_id`)
  return normalized
}

function requireChatId(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !/^oc_[A-Za-z0-9]+$/.test(value)) {
    throw new Error(`${operation}: lark-cli returned no valid chat id`)
  }
  return value
}

function requireMessageId(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !/^om_[A-Za-z0-9]+$/.test(value)) {
    throw new Error(`${operation}: lark-cli returned no valid message id`)
  }
  return value
}

/** Only the documented "chat already deleted" code is an idempotent delete. */
function envelopeErrorCode(value: unknown): number | undefined {
  const envelope = recordOf(value)
  const error = recordOf(envelope?.['error'])
  const data = recordOf(envelope?.['data'])
  for (const candidate of [error?.['code'], envelope?.['code'], data?.['code']]) {
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) return candidate
    if (typeof candidate === 'string' && /^\d+$/.test(candidate)) return Number(candidate)
  }
  return undefined
}

async function createChatStrict(
  input: {
    readonly name: string
    readonly userOpenIds: readonly string[]
    readonly ownerOpenId?: string
  },
  binary: string,
  runner: LarkCliRunner,
): Promise<string> {
  const name = requireInput(input.name, 'group name')
  const users = input.userOpenIds.map((id, index) => requireOpenId(id, `group user ${index + 1}`))
  const owner = input.ownerOpenId === undefined
    ? undefined
    : requireOpenId(input.ownerOpenId, 'group owner')
  const args = ['im', '+chat-create', '--as', 'bot', '--name', name]
  if (users.length > 0) args.push('--users', users.join(','))
  if (owner !== undefined) args.push('--owner', owner)
  args.push('--json')
  const result = await callJson(args, binary, runner)
  const data = recordOf(strictEnvelopeData(result, 'create group'))
  return requireChatId(data?.['chat_id'], 'create group')
}

/** Parse and verify the top-level `auth status` response. */
export function parseBotIdentity(value: unknown, expectedAppId: string): LarkIdentityProbe {
  if (typeof value !== 'object' || value === null) {
    return { kind: 'unavailable', diagnostic: 'lark-cli returned an unreadable bot identity.' }
  }
  const record = value as Record<string, unknown>
  const appId = record['appId']
  const identities = record['identities']
  const bot =
    typeof identities === 'object' && identities !== null
      ? (identities as Record<string, unknown>)['bot']
      : undefined
  if (typeof appId !== 'string' || appId !== expectedAppId) {
    return { kind: 'unavailable', diagnostic: 'The Pet lark-cli profile belongs to another app.' }
  }
  if (typeof bot !== 'object' || bot === null) {
    return { kind: 'unavailable', diagnostic: 'The Pet lark-cli profile has no bot identity.' }
  }
  const identity = bot as Record<string, unknown>
  if (
    identity['status'] !== 'ready' ||
    identity['available'] !== true ||
    record['verified'] !== true
  ) {
    return { kind: 'unavailable', diagnostic: 'The Pet bot identity is not ready or verified.' }
  }
  const openId = identity['openId']
  if (typeof openId !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(openId)) {
    return { kind: 'unavailable', diagnostic: 'The verified Pet bot identity has no open_id.' }
  }
  const appName = identity['appName']
  return {
    kind: 'ready',
    identity: {
      appId,
      openId,
      ...(typeof appName === 'string' && appName.trim() !== '' ? { name: appName } : {}),
    },
  }
}

/** Parse the verified current-user identity from the real top-level auth status shape. */
export function parseUserIdentity(value: unknown, expectedAppId: string): LarkUserIdentityProbe {
  if (typeof value !== 'object' || value === null) {
    return { kind: 'unavailable', diagnostic: 'lark-cli returned an unreadable user identity.' }
  }
  const record = value as Record<string, unknown>
  const appId = record['appId']
  const identities = record['identities']
  const user =
    typeof identities === 'object' && identities !== null
      ? (identities as Record<string, unknown>)['user']
      : undefined
  if (typeof appId !== 'string' || appId !== expectedAppId) {
    return { kind: 'unavailable', diagnostic: 'The Pet lark-cli profile belongs to another app.' }
  }
  if (typeof user !== 'object' || user === null) {
    return { kind: 'unavailable', diagnostic: 'The Pet lark-cli profile has no current user identity.' }
  }
  const identity = user as Record<string, unknown>
  if (
    identity['status'] !== 'ready' ||
    identity['available'] !== true ||
    identity['tokenStatus'] !== 'ready' ||
    record['verified'] !== true
  ) {
    return { kind: 'unavailable', diagnostic: 'The Pet user identity is not ready or verified.' }
  }
  const openId = identity['openId']
  if (typeof openId !== 'string' || !/^ou_[A-Za-z0-9]+$/.test(openId)) {
    return { kind: 'unavailable', diagnostic: 'The verified Pet user identity has no open_id.' }
  }
  const userName = identity['userName']
  return {
    kind: 'ready',
    identity: {
      appId,
      openId,
      ...(typeof userName === 'string' && userName.trim() !== '' ? { name: userName } : {}),
    },
  }
}

/** Extract only safe fields from a lark-cli permission response. */
export function permissionDiagnostic(value: unknown): LarkPermissionDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const outer = value as Record<string, unknown>
  const raw =
    typeof outer['error'] === 'object' && outer['error'] !== null
      ? (outer['error'] as Record<string, unknown>)
      : outer
  const subtype = raw['subtype']
  const scopes = raw['missing_scopes']
  if (subtype !== 'app_scope_not_applied' && !Array.isArray(scopes)) return undefined
  const missingScopes = Array.isArray(scopes)
    ? scopes.filter((scope): scope is string => typeof scope === 'string')
    : []
  const url = raw['console_url']
  let consoleUrl: string | undefined
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' && parsed.hostname === 'open.feishu.cn') consoleUrl = url
    } catch {
      // An untrusted or malformed URL is deliberately omitted.
    }
  }
  const code = raw['code']
  return {
    ...(typeof code === 'number' ? { code } : {}),
    missingScopes,
    ...(consoleUrl !== undefined ? { consoleUrl } : {}),
  }
}

/**
 * Build a Lark client backed by the local `lark-cli`.
 *
 * Every method is FAIL-SOFT by design: reactions, history and replies are
 * decoration around work that has already been accepted, so a Lark outage
 * degrades presentation instead of dropping the user's request.
 * @param binary - lark-cli executable, overridable for tests.
 * @returns the client.
 */
export function createLarkCliClient(
  binary = 'lark-cli',
  runner: LarkCliRunner = run as unknown as LarkCliRunner,
): LarkClient {
  return {
    async cliVersion() {
      try {
        const result = await runner(binary, ['--version'], {
          timeout: CALL_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        })
        const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(result.stdout.trim())
        if (match === null) return { supported: false }
        const major = Number(match[1])
        const minor = Number(match[2])
        const patch = Number(match[3])
        return {
          supported: major > 1 || (major === 1 && (minor > 0 || patch >= 93)),
          version: `${major}.${minor}.${patch}`,
        }
      } catch {
        return { supported: false }
      }
    },

    async addReaction(messageId, emoji) {
      const data = await callCli(
        [
          'im',
          'reactions',
          'create',
          '--as',
          'bot',
          '--message-id',
          messageId,
          '--data',
          JSON.stringify({ reaction_type: { emoji_type: emoji } }),
        ],
        binary,
        runner,
      )
      const reactionId = (data as { reaction_id?: unknown } | undefined)?.reaction_id
      return typeof reactionId === 'string' ? reactionId : undefined
    },

    async removeReaction(messageId, reactionId) {
      await callCli(
        [
          'im',
          'reactions',
          'delete',
          '--as',
          'bot',
          '--message-id',
          messageId,
          '--reaction-id',
          reactionId,
        ],
        binary,
        runner,
      )
    },

    async listMessages(chatId, limit) {
      const data = await callCli(
        [
          'im',
          '+chat-messages-list',
          '--as',
          'bot',
          '--chat-id',
          chatId,
          '--order',
          'desc',
          '--page-size',
          String(limit),
        ],
        binary,
        runner,
      )
      const messages = (data as { messages?: unknown } | undefined)?.messages
      if (!Array.isArray(messages)) return []
      const parsed: LarkHistoryMessage[] = []
      for (const entry of messages) {
        if (typeof entry !== 'object' || entry === null) continue
        const record = entry as Record<string, unknown>
        const messageId = record['message_id']
        if (typeof messageId !== 'string') continue
        const sender = record['sender'] as { name?: unknown } | undefined
        parsed.push({
          messageId,
          senderName: typeof sender?.name === 'string' ? sender.name : 'unknown',
          text: typeof record['content'] === 'string' ? record['content'] : '',
          createTime: typeof record['create_time'] === 'string' ? record['create_time'] : '',
          position: Number(record['message_position'] ?? 0),
        })
      }
      return parsed
    },

    async botReady() {
      // `auth status` answers at the TOP LEVEL, not inside the usual `data`
      // envelope, so the ordinary reader would find nothing here.
      // See docs/notes/dsh-plugin-integration-pitfalls.md §3.
      const result = await callJson(['auth', 'status', '--json', '--verify'], binary, runner)
      const bot = (
        result.value as { identities?: { bot?: { available?: unknown; status?: unknown } } } | undefined
      )?.identities?.bot
      return result.ok && bot?.available === true && bot.status === 'ready'
    },

    async botIdentity(expectedAppId) {
      const result = await callJson(['auth', 'status', '--json', '--verify'], binary, runner)
      if (!result.ok) {
        return {
          kind: 'unavailable',
          diagnostic: '无法验证 dsh-pet 专属 lark-cli profile；请用 App Secret 重新连接。',
        }
      }
      return parseBotIdentity(result.value, expectedAppId)
    },

    async userIdentity(expectedAppId) {
      const result = await callJson(['auth', 'status', '--json', '--verify'], binary, runner)
      if (!result.ok) {
        return {
          kind: 'unavailable',
          diagnostic: '无法验证 dsh-pet 专属 lark-cli profile 的当前用户身份。',
        }
      }
      return parseUserIdentity(result.value, expectedAppId)
    },

    async defaultQaOwner(expectedAppId, allowOpenIds) {
      const result = await callJson(['auth', 'status', '--json', '--verify'], binary, runner)
      if (!result.ok) {
        return {
          kind: 'unavailable',
          diagnostic: '无法验证 dsh-pet 专属 lark-cli profile 的当前用户身份。',
        }
      }
      const user = parseUserIdentity(result.value, expectedAppId)
      if (user.kind !== 'ready') return user
      if (!allowOpenIds.includes(user.identity.openId)) {
        return {
          kind: 'unavailable',
          diagnostic: '当前已验证飞书用户不在 Pet allowlist 中。',
        }
      }
      return { kind: 'ready', ownerId: user.identity.openId }
    },

    async chatName(chatId) {
      const data = await callCli(
        ['im', 'chats', 'get', '--as', 'bot', '--chat-id', chatId],
        binary,
        runner,
      )
      const name = (data as { name?: unknown } | undefined)?.name
      return typeof name === 'string' && name.trim() !== '' ? name : undefined
    },

    async listChatBots(chatId) {
      const result = await callJson(
        [
          'im',
          '+chat-members-list',
          '--as',
          'bot',
          '--chat-id',
          chatId,
          '--member-types',
          'bot',
        ],
        binary,
        runner,
      )
      if (!result.ok) {
        const diagnostic = permissionDiagnostic(result.value)
        return diagnostic === undefined
          ? { kind: 'error' }
          : { kind: 'permission-denied', diagnostic }
      }
      const envelope = result.value as { ok?: boolean; data?: unknown } | undefined
      if (envelope?.ok !== true) return { kind: 'error' }
      const bots = (envelope.data as { bots?: unknown } | undefined)?.bots
      if (!Array.isArray(bots)) return { kind: 'ok', bots: [] }
      const parsed: LarkChatBot[] = []
      for (const entry of bots) {
        if (typeof entry !== 'object' || entry === null) continue
        const record = entry as Record<string, unknown>
        const appId = record['app_id']
        const openId = record['member_id']
        if (typeof appId !== 'string' || typeof openId !== 'string') continue
        parsed.push({
          appId,
          openId,
          name: typeof record['name'] === 'string' ? record['name'] : '',
        })
      }
      return { kind: 'ok', bots: parsed }
    },

    async reply(messageId, text) {
      await callCli(
        ['im', '+messages-reply', '--as', 'bot', '--message-id', messageId, '--text', text],
        binary,
        runner,
      )
    },

    async replyExact(messageIdInput, textInput) {
      const messageId = requireMessageId(requireInput(messageIdInput, 'message id'), 'reply exact')
      const text = requireInput(textInput, 'reply text')
      const result = await callJson(
        ['im', '+messages-reply', '--as', 'bot', '--message-id', messageId, '--text', text, '--json'],
        binary,
        runner,
      )
      const data = recordOf(strictEnvelopeData(result, 'reply exact'))
      requireMessageId(data?.['message_id'], 'reply exact')
    },

    async replyStrict(messageId, text) {
      const result = await callJson(
        ['im', '+messages-reply', '--as', 'bot', '--message-id', messageId, '--text', text],
        binary,
        runner,
      )
      const envelope = result.value as { ok?: unknown } | undefined
      if (!result.ok || envelope?.ok !== true) {
        throw new Error('lark-cli could not send the pairing receipt')
      }
    },

    async createChat(name, userOpenIds, ownerOpenId) {
      // Deliberately NOT routed through `callCli`, which swallows every
      // failure into `undefined`. A QA binding written against a group that
      // was never created is exactly the silent breakage the transaction
      // exists to prevent, so this call uses the shared strict creation path.
      return createChatStrict(
        { name, userOpenIds, ...(ownerOpenId === undefined ? {} : { ownerOpenId }) },
        binary,
        runner,
      )
    },

    async memberCount(chatId) {
      const data = await callCli(
        ['im', '+chat-members-list', '--as', 'bot', '--chat-id', chatId, '--page-all'],
        binary,
        runner,
      )
      const users = (data as { users?: unknown } | undefined)?.users
      return Array.isArray(users) ? users.length : undefined
    },

    async sendToChat(chatId, text) {
      await callCli(
        ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--text', text],
        binary,
        runner,
      )
    },
  }
}

/**
 * Strict Lark transaction port for the unified locus controller.
 *
 * The ordinary channel client is intentionally fail-soft.  This port is the
 * opposite: group provisioning, source-switch receipts, and rollback are
 * transaction boundaries, so every process/envelope/identifier mismatch is a
 * rejected promise.  It still remains credential-zero-touch — calls always go
 * through Pet's fixed lark-cli profile and explicit bot identity.
 *
 * Kept as a factory in this module (rather than wired in `index.ts`) so the
 * controller integration can adopt it without coupling this isolated adapter
 * to Host composition.
 */
export function createLocusLarkPort(
  binary = 'lark-cli',
  runner: LarkCliRunner = run as unknown as LarkCliRunner,
): LocusLarkPort {
  const deleteGroup = async (chatIdInput: string): Promise<void> => {
    const chatId = requireChatId(requireInput(chatIdInput, 'chat id'), 'delete group')
    const result = await callJson(
      ['api', 'DELETE', `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`, '--as', 'bot', '--json'],
      binary,
      runner,
    )
    // Feishu 232009 means the chat is already deleted/not found.  Treat that
    // one documented state as an idempotent rollback; permission failures and
    // every other API/process failure must reach the controller so it can
    // report a possibly residual group.
    if (envelopeErrorCode(result.value) === 232009) return
    strictEnvelopeData(result, 'delete group')
  }

  return {
    async createGroup(input) {
      const ownerId = requireOpenId(input.ownerId, 'group owner')
      const name = requireInput(input.name, 'group name')
      const chatId = await createChatStrict(
        // Both flags are explicit.  The human owner is also the only invited
        // user; relying on creator defaults would leave the bot as owner.
        { name, ownerOpenId: ownerId, userOpenIds: [ownerId] },
        binary,
        runner,
      )
      return {
        chatId,
        chatName: name,
        rollback: () => deleteGroup(chatId),
      }
    },

    async sendControlMessage(input) {
      const chatId = requireChatId(requireInput(input.endpoint.chatId, 'chat id'), 'send control message')
      if (input.endpoint.threadId !== undefined) {
        // This port has no message/root id with which to prove a thread reply.
        // Widening it to the parent chat would put a source-switch warning in
        // the wrong collaboration entry, so fail closed.
        throw new Error('send control message: thread endpoint has no safe reply target')
      }
      const text = requireInput(input.text, 'control message text')
      const result = await callJson(
        ['im', '+messages-send', '--as', 'bot', '--chat-id', chatId, '--text', text, '--json'],
        binary,
        runner,
      )
      const data = recordOf(strictEnvelopeData(result, 'send control message'))
      requireMessageId(data?.['message_id'], 'send control message')
      const returnedChatId = requireChatId(data?.['chat_id'], 'send control message')
      if (returnedChatId !== chatId) {
        throw new Error('send control message: lark-cli returned a different chat id')
      }
    },

    deleteGroup,
  }
}
