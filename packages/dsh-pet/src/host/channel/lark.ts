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
import type { ConnectionCountRead } from './connection-gate.js'
import { SUBSCRIBE_MIN_VERSION, versionAtLeast } from './connection-gate.js'
import { promisify } from 'node:util'
import { PET_CLI_PROFILE, petCliArgs } from './cli.js'
import type { LocusLarkPort } from '../locus/controller.js'
import type { LocusReplyTarget } from '../locus/context.js'
import { hasMentionCandidate, renderMentions, type MentionMember } from './mentions.js'

const run = promisify(execFile)

export type LarkCliRunner = (
  binary: string,
  args: readonly string[],
  options: { windowsHide?: boolean; timeout: number; maxBuffer: number; signal?: AbortSignal },
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

/**
 * One message of a caller-bound entrance read.
 *
 * `createTime` is normalized to ISO 8601 with an offset. The CLI prints the
 * platform time as local wall-clock minutes, which is too lossy for a
 * `[since, before)` window, so the adapter converts it once, explicitly,
 * instead of letting each consumer guess.
 */
export interface LarkEntranceMessage {
  readonly messageId: string
  readonly createTime: string
  readonly senderName?: string
  readonly text: string
  readonly messagePosition?: string
  readonly threadId?: string
}

/** One page of an entrance read; `pageToken` continues into the next page. */
export interface LarkEntrancePage {
  readonly messages: readonly LarkEntranceMessage[]
  readonly hasMore: boolean
  readonly pageToken?: string
}

/** The exact entrance a read is bound to, plus page direction and token. */
export interface LarkEntranceReadInput {
  readonly chatId: string
  /** Set only when the entrance itself is a topic. */
  readonly threadId?: string
  readonly pageSize: number
  readonly direction: 'older' | 'newer'
  readonly pageToken?: string
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

/** One reply on a docx comment thread. */
export interface DocCommentReply {
  readonly replyId: string
  readonly authorOpenId?: string
  readonly createdAt?: number
  readonly text: string
}

/** Result of reading one comment and locating its trigger reply. */
export type DocCommentQuery =
  | {
      readonly kind: 'ok'
      readonly isWhole: boolean
      readonly quote?: string
      readonly replies: readonly DocCommentReply[]
      readonly trigger: DocCommentReply
    }
  /** The call failed (platform error, timeout, unparsable): retryable. */
  | { readonly kind: 'error' }
  /** The comment came back without a usable `is_whole`, or not at all. */
  | { readonly kind: 'scope-unknown' }
  /** The comment is known but the trigger reply is absent after paging. */
  | { readonly kind: 'reply-missing' }

/** Bot-identity Lark operations Pet depends on. */
export interface LarkClient {
  /** Detect whether the installed CLI exposes the identity contract Pet needs. */
  cliVersion?(): Promise<{ readonly supported: boolean; readonly version?: string }>
  /**
   * The app's live event-connection count (`GET /open-apis/event/v1/connection`
   * as the bot). One app supports one connection; see `connection-gate.ts`.
   */
  eventConnectionCount?(): Promise<ConnectionCountRead>
  /**
   * IM intake preconditions via `event consume im.message.receive_v1 --dry-run`
   * (side-effect free: no bus, no connection). Returns the `blocked` ones;
   * `unknown` is not blocked because a real run proceeds on it. `undefined`
   * when the dry-run itself could not be read.
   */
  imPreconditions?(): Promise<{ readonly blocked: readonly string[] } | undefined>
  /**
   * Comment facts for one docx comment (`drive +batch-query-comments`), with
   * the trigger reply's text located by paging `drive +list-replies` when the
   * card reports `has_more` (≤10 pages). Failure and "not found" are distinct.
   */
  queryDocComment?(token: string, commentId: string, replyId: string): Promise<DocCommentQuery>
  /** Append a plain-text bot reply under a docx comment (`drive +add-reply`). */
  replyComment?(token: string, commentId: string, text: string): Promise<'success' | 'unknown'>
  /**
   * Answer a whole-document comment. Feishu refuses replies to `is_whole`
   * comments (1069302), so the bot opens a NEW full comment that first
   * mentions the asker. `success` only on a returned `comment_id`.
   */
  addWholeComment?(token: string, mentionOpenId: string, text: string): Promise<'success' | 'unknown'>
  /** Add or remove a bot reaction on a comment reply (`drive +react-reply`). */
  reactCommentReply?(token: string, replyId: string, emoji: string, action: 'add' | 'delete'): Promise<void>
  /** A user's display name by open_id (`contact +get-user` as bot); undefined when unreadable. */
  contactName?(openId: string): Promise<string | undefined>
  /** Title and URL of a docx (`drive +inspect`); undefined when unreadable. */
  inspectDoc?(token: string): Promise<{ readonly title?: string; readonly url?: string } | undefined>
  /** The docx body as markdown (`docs +fetch`); a failure carries the platform code. */
  fetchDocMarkdown?(token: string): Promise<{ readonly ok: true; readonly markdown: string } | { readonly ok: false; readonly code?: string }>
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
   * Read one page of THIS entrance's messages as the bound bot.
   *
   * Separate from {@link listMessages}: that one exists to resolve the trigger's
   * sender name and returns an empty array on failure. This one must let its
   * caller tell a FAILED read from a genuinely empty window, so it returns
   * `undefined` on failure and carries the page facts a caller needs to
   * continue. A topic-bound entrance reads that topic rather than the group.
   * @param input - Exact entrance plus page direction/size/token.
   * @returns the page, or `undefined` when the read failed.
   */
  readEntranceHistory?(input: LarkEntranceReadInput): Promise<LarkEntrancePage | undefined>
  /**
   * Take one bounded read of THIS entrance to measure whether it is readable.
   *
   * Exists so a delivery never declares a capability nobody verified. The
   * result is deliberately a boolean: message content must not be laundered
   * through a capability check, which is why this is not `readEntranceHistory`
   * with a small page size at the call site.
   * @param input - Exact entrance (group, or the bound topic).
   * @returns whether a real read of this entrance succeeded just now.
   */
  probeEntranceRead?(input: {
    readonly chatId: string
    readonly threadId?: string
  }): Promise<boolean>
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
   * Resolve one chat member's display name.
   *
   * Used to tell the delivery prompt who is asking. A prompt that reports only
   * an `ou_…` invites the agent to address the person with that identifier,
   * which renders as plain text and publishes the id. Optional so every
   * existing fake keeps its behaviour.
   * @param chatId - Chat the member belongs to.
   * @param openId - Member open id (`ou_…`).
   * @returns the display name, or undefined when it cannot be resolved.
   */
  resolveMemberName?(chatId: string, openId: string): Promise<string | undefined>
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
   * Reply to a Host-resolved Delivery target, preserving topic semantics.
   * The model never supplies this target: the Host derives it from the
   * accepted Delivery. The returned id is checked before this resolves.
   */
  replyToTarget?(target: LocusReplyTarget, text: string): Promise<{ readonly messageId: string }>
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
   * Read the human members of one chat, for mention rendering.
   *
   * Same command and same bot identity as {@link memberCount}: the mapping from
   * a display name to an open id only exists inside the chat, and resolving it
   * anywhere else (tenant-wide search, user identity) would both widen the read
   * surface and break the outbound-identity rule.
   * @param chatId - Target chat.
   * @returns members, or `undefined` when they cannot be read.
   */
  listChatMembers?(chatId: string): Promise<readonly MentionMember[] | undefined>
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

/** How long one chat's member list is reused for mention rendering. */
const MEMBER_CACHE_TTL_MS = 5 * 60_000

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

/**
 * Normalize the CLI's local wall-clock `create_time` to ISO 8601 with offset.
 *
 * `+chat-messages-list` prints `2026-10-12 16:49` (minute precision, host local
 * time), which cannot be compared against an offset-bearing `[since, before)`
 * window without guessing. Converting once here keeps one explicit
 * representation; an unrecognized value is returned unchanged rather than
 * invented.
 *
 * @param value - Raw `create_time` from the CLI envelope.
 * @returns ISO 8601 with the host offset, or the input unchanged.
 */
function normalizeEntranceTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (match === null) return value
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? '0'),
    0,
  )
  if (Number.isNaN(date.getTime())) return value
  const pad = (part: number): string => String(part).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

/** Invoke lark-cli and retain a structured error response without raw text. */
/**
 * Read one page of an entrance as the bound bot.
 *
 * Shared by the caller-bound read and by the bounded capability probe so both
 * hit exactly the same platform path: a probe that used a different call would
 * prove the wrong capability.
 *
 * A failed call is NOT an empty page: the caller must be able to say "could not
 * read" instead of "nothing was said", hence `undefined`.
 *
 * @param binary - lark-cli binary.
 * @param runner - CLI runner.
 * @param input - Exact entrance plus page direction/size/token.
 * @returns the normalized page, or `undefined` when the read failed.
 */
async function readEntranceHistoryWith(
  binary: string,
  runner: LarkCliRunner,
  input: LarkEntranceReadInput,
): Promise<LarkEntrancePage | undefined> {
  // The platform prints `create_time` as local wall-clock minutes, which is
  // too coarse for a `[since, before)` window; normalizing it here keeps
  // every consumer on one explicit representation.
  const args = input.threadId === undefined
    ? [
      'im', '+chat-messages-list', '--as', 'bot', '--chat-id', input.chatId,
      '--order', input.direction === 'older' ? 'desc' : 'asc',
      '--page-size', String(input.pageSize), '--no-reactions',
    ]
    : [
      'im', '+threads-messages-list', '--as', 'bot', '--thread', input.threadId,
      '--order', input.direction === 'older' ? 'desc' : 'asc',
      '--page-size', String(input.pageSize), '--no-reactions',
    ]
  const data = await callCli(
    input.pageToken === undefined ? args : [...args, '--page-token', input.pageToken],
    binary,
    runner,
  )
  if (data === undefined) return undefined
  const record = data as {
    messages?: unknown
    has_more?: unknown
    page_token?: unknown
  }
  if (!Array.isArray(record.messages)) return undefined
  const messages: LarkEntranceMessage[] = []
  for (const entry of record.messages) {
    if (typeof entry !== 'object' || entry === null) continue
    const message = entry as Record<string, unknown>
    const messageId = message['message_id']
    if (typeof messageId !== 'string') continue
    const sender = message['sender'] as { name?: unknown } | undefined
    const rawCreateTime = typeof message['create_time'] === 'string' ? message['create_time'] : ''
    const threadId = message['thread_id']
    messages.push({
      messageId,
      createTime: normalizeEntranceTime(rawCreateTime),
      ...(typeof sender?.name === 'string' && sender.name !== ''
        ? { senderName: sender.name }
        : {}),
      text: typeof message['content'] === 'string' ? message['content'] : '',
      ...(typeof message['message_position'] === 'string'
        ? { messagePosition: message['message_position'] }
        : {}),
      ...(typeof threadId === 'string' && threadId !== '' ? { threadId } : {}),
    })
  }
  return {
    messages,
    hasMore: record.has_more === true,
    ...(typeof record.page_token === 'string' && record.page_token !== ''
      ? { pageToken: record.page_token }
      : {}),
  }
}

async function callJson(
  args: readonly string[],
  binary: string,
  runner: LarkCliRunner,
): Promise<CliJsonResult> {
  assertNoDocIdentifier(args)
  let text: string | undefined
  let ok = true
  try {
    const result = await runner(binary, petCliArgs(args), {
      windowsHide: true,
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

/**
 * Doc-comment loci keep their category in the id (`doc:docx:<token>`,
 * `doc:docx:<token>/<comment>/<reply>`; pet-locus-doc-comments D4). Not every
 * IM method validates the `oc_`/`om_` shape, so this single choke point makes
 * the "IM egress never receives a doc id" invariant hold for all of them: any
 * argument value carrying the doc prefix throws before lark-cli runs. Doc
 * egress (drive commands) passes the raw token and never trips this.
 */
function assertNoDocIdentifier(args: readonly string[]): void {
  for (const arg of args) {
    if (arg.startsWith('doc:')) {
      throw new Error('A doc-comment identifier reached an IM lark-cli call; refusing to send.')
    }
  }
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

function requireDocToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9]+$/.test(value)) {
    throw new Error('A docx token must be non-empty alphanumerics.')
  }
  return value
}

function requireNumericId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new Error(`A ${field} must be digits.`)
  return value
}

/** Render a comment reply's elements as plain text; mentions become `@<open_id>`. */
function parseCommentReplies(value: unknown): DocCommentReply[] {
  if (!Array.isArray(value)) return []
  const out: DocCommentReply[] = []
  for (const raw of value) {
    const reply = recordOf(raw)
    const replyId = reply?.['reply_id']
    if (reply === undefined || typeof replyId !== 'string' || replyId === '') continue
    const elements = recordOf(reply['content'])?.['elements']
    const text = (Array.isArray(elements) ? elements : [])
      .map(recordOf)
      .map(element => {
        if (element === undefined) return ''
        const run = recordOf(element['text_run'])
        if (typeof run?.['text'] === 'string') return run['text']
        const person = recordOf(element['person'])
        if (typeof person?.['user_id'] === 'string') return `@${person['user_id']}`
        const link = recordOf(element['docs_link'])
        if (typeof link?.['url'] === 'string') return link['url']
        return ''
      })
      .join('')
      .trim()
    const author = reply['user_id']
    const created = reply['create_time']
    out.push({
      replyId,
      text,
      ...(typeof author === 'string' && author !== '' ? { authorOpenId: author } : {}),
      ...(typeof created === 'number' && Number.isFinite(created) ? { createdAt: created * 1000 } : {}),
    })
  }
  return out
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

/**
 * Read `auth status --json --verify` for a current-user proof.
 *
 * When the user access token has expired, the `--verify` call itself performs
 * the refresh ("server verification succeeded after refresh") yet still
 * reports `identities.user.status: 'needs_refresh'` for that one response; the
 * next call reports `ready`. Taking the first answer would refuse every user
 * action that happens to land on a token expiry (every ~2h). Re-read exactly
 * once in that case. The second answer must still pass the full gate on its
 * own, so a genuinely stale or unverified login keeps failing closed.
 * See docs/architecture/dsh-plugin-integration-pitfalls.md §7.
 */
async function readUserAuthStatus(binary: string, runner: LarkCliRunner): Promise<CliJsonResult> {
  const args = ['auth', 'status', '--json', '--verify']
  const first = await callJson(args, binary, runner)
  const user = recordOf(recordOf(recordOf(first.value)?.['identities'])?.['user'])
  if (user?.['status'] !== 'needs_refresh') return first
  return callJson(args, binary, runner)
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
  // `status` carries freshness: a stale profile reports `needs_refresh` here,
  // and `--verify` proves the credential was actually exercised rather than
  // read from disk. `tokenStatus` is deliberately NOT compared against a
  // literal — lark-cli reports `valid` (not `ready`) for a usable token, and
  // its full vocabulary is undocumented, so pinning any single value would
  // again make this gate unsatisfiable the moment the vocabulary shifts. The
  // two checks below are the ones whose accepted values are observable and
  // load-bearing; `available` additionally guards the identity being usable
  // at all. See docs/architecture/dsh-plugin-integration-pitfalls.md §4: field
  // vocabularies must be measured, never inferred.
  if (
    identity['status'] !== 'ready' ||
    identity['available'] !== true ||
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
 * @param runner - process runner, overridable for tests.
 * @param log - operator diagnostic sink for fail-soft degradations.
 * @returns the client.
 */
export function createLarkCliClient(
  binary = 'lark-cli',
  runner: LarkCliRunner = run as unknown as LarkCliRunner,
  /**
   * Operator diagnostic sink. Optional so every existing caller keeps its
   * behaviour; index.ts passes Pet's namespaced logger. Messages must stay
   * low-cardinality — never a member name, open id, chat id or body.
   */
  log: (message: string) => void = () => {},
): LarkClient {
  /**
   * Read one chat's human members, cached briefly per chat.
   *
   * The member list is what makes mention rendering exact, and it changes
   * rarely; a short TTL keeps the extra call off the common path without
   * letting the mapping go stale for long. Any failure resolves to `undefined`
   * so callers degrade instead of blocking on a read they do not require.
   */
  const memberCache = new Map<string, { readonly at: number; readonly members: readonly MentionMember[] }>()
  async function memberList(chatId: string): Promise<readonly MentionMember[] | undefined> {
    const cached = memberCache.get(chatId)
    const now = Date.now()
    if (cached !== undefined && now - cached.at < MEMBER_CACHE_TTL_MS) return cached.members
    const data = await callCli(
      ['im', '+chat-members-list', '--as', 'bot', '--chat-id', chatId, '--member-types', 'user', '--page-all'],
      binary,
      runner,
    )
    const users = (data as { users?: unknown } | undefined)?.users
    if (!Array.isArray(users)) return undefined
    const members: MentionMember[] = []
    for (const entry of users) {
      if (typeof entry !== 'object' || entry === null) continue
      const record = entry as { member_id?: unknown; name?: unknown }
      if (typeof record.member_id !== 'string' || typeof record.name !== 'string') continue
      if (record.member_id.trim() === '' || record.name.trim() === '') continue
      members.push({ openId: record.member_id.trim(), name: record.name.trim() })
    }
    memberCache.set(chatId, { at: now, members })
    return members
  }

  /**
   * Turn the agent's `@display-name` references into real mentions.
   *
   * Fail-soft on purpose: rendering is an enhancement, and a member-list read
   * that fails must not cost the user their answer. Diagnostics stay
   * low-cardinality — a count and a reason class, never a name or open id.
   */
  async function renderReplyMentions(chatId: string, text: string): Promise<string> {
    if (!hasMentionCandidate(text)) return text
    try {
      const members = await memberList(chatId)
      if (members === undefined) {
        log('lark reply mentions: member list unavailable; sending text unchanged')
        return text
      }
      const rendered = renderMentions(text, members)
      if (rendered.rendered === 0) {
        if (rendered.skipped !== undefined) {
          log(`lark reply mentions: unchanged (${rendered.skipped})`)
        }
        return text
      }
      log(`lark reply mentions: rendered ${String(rendered.rendered)}`)
      return rendered.text
    } catch {
      log('lark reply mentions: rendering failed; sending text unchanged')
      return text
    }
  }
  return {
    async cliVersion() {
      try {
        const result = await runner(binary, ['--version'], {
          windowsHide: true,
          timeout: CALL_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        })
        const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(result.stdout.trim())
        if (match === null) return { supported: false }
        const version = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
        // One floor for enable, pairing and the spawn gate: `+subscribe`'s
        // contract was verified on 1.0.97 (pet-locus-doc-comments D2).
        return { supported: versionAtLeast(version, SUBSCRIBE_MIN_VERSION), version }
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

    async readEntranceHistory(input) {
      return readEntranceHistoryWith(binary, runner, input)
    },

    async probeEntranceRead(input) {
      // One real read of the exact entrance, with the smallest page the CLI
      // accepts; only success/failure escapes, never the content.
      const page = await readEntranceHistoryWith(binary, runner, {
        chatId: input.chatId,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        pageSize: 1,
        direction: 'older',
      })
      return page !== undefined
    },

    async eventConnectionCount(): Promise<ConnectionCountRead> {
      const result = await callJson(['api', 'GET', '/open-apis/event/v1/connection', '--as', 'bot'], binary, runner)
      const value = recordOf(result.value)
      const data = recordOf(value?.['data'])
      const count = data?.['online_instance_cnt']
      // lark-cli prints `{ ok: true, identity, data }` (it unwraps the OpenAPI
      // `code`/`msg`); a raw-OpenAPI `code: 0` is accepted too. Anything else,
      // including a missing or non-integer count, is unknown, never zero.
      const succeeded = value?.['ok'] === true || value?.['code'] === 0
      if (result.ok && succeeded && typeof count === 'number' && Number.isInteger(count) && count >= 0) {
        return { kind: 'count', count }
      }
      const error = recordOf(value?.['error'])
      const text = `${String(error?.['type'] ?? '')} ${String(error?.['subtype'] ?? '')} ${String(error?.['message'] ?? '')}`
      return { kind: 'error', authFailure: /auth|login|token|credential|unauthori/i.test(text) }
    },

    async imPreconditions() {
      const result = await callJson(['event', 'consume', 'im.message.receive_v1', '--as', 'bot', '--dry-run'], binary, runner)
      if (!result.ok) return undefined
      const decision = recordOf(recordOf(recordOf(result.value)?.['data'])?.['decision'])
      const preconditions = decision?.['preconditions']
      if (!Array.isArray(preconditions)) return undefined
      const blocked = preconditions
        .map(recordOf)
        .filter(item => item?.['status'] === 'blocked')
        .map(item => String(item?.['name'] ?? 'unknown'))
      return { blocked }
    },

    async queryDocComment(token, commentId, replyId): Promise<DocCommentQuery> {
      const target = ['--token', requireDocToken(token), '--type', 'docx']
      const result = await callJson(
        ['drive', '+batch-query-comments', '--as', 'bot', ...target, '--comment-ids', requireNumericId(commentId, 'comment id')],
        binary,
        runner,
      )
      const envelope = recordOf(result.value)
      if (!result.ok || envelope?.['ok'] !== true) return { kind: 'error' }
      const items = recordOf(envelope['data'])?.['items']
      if (!Array.isArray(items)) return { kind: 'error' }
      const card = items.map(recordOf).find(item => item?.['comment_id'] === commentId)
      if (card === undefined || typeof card['is_whole'] !== 'boolean') return { kind: 'scope-unknown' }
      const replies = [...parseCommentReplies(recordOf(card['reply_list'])?.['replies'])]
      let trigger = replies.find(reply => reply.replyId === replyId)
      if (trigger === undefined && card['has_more'] === true) {
        let pageToken: string | undefined
        for (let page = 0; page < 10 && trigger === undefined; page += 1) {
          const listed = await callJson(
            ['drive', '+list-replies', '--as', 'bot', ...target, '--comment-id', commentId, '--page-size', '100',
              ...(pageToken === undefined ? [] : ['--page-token', pageToken])],
            binary,
            runner,
          )
          const data = recordOf(recordOf(listed.value)?.['data'])
          if (!listed.ok || data === undefined) return { kind: 'error' }
          for (const reply of parseCommentReplies(data['items'] ?? data['replies'])) {
            if (!replies.some(known => known.replyId === reply.replyId)) replies.push(reply)
          }
          trigger = replies.find(reply => reply.replyId === replyId)
          const next = data['page_token']
          if (data['has_more'] !== true || typeof next !== 'string' || next === '') break
          pageToken = next
        }
      }
      if (trigger === undefined) return { kind: 'reply-missing' }
      const quote = typeof card['quote'] === 'string' && card['quote'] !== '' ? card['quote'] : undefined
      return { kind: 'ok', isWhole: card['is_whole'], ...(quote === undefined ? {} : { quote }), replies, trigger }
    },

    async replyComment(token, commentId, text) {
      const content = JSON.stringify([{ type: 'text', text: requireInput(text, 'comment reply text') }])
      const result = await callJson(
        ['drive', '+add-reply', '--as', 'bot', '--token', requireDocToken(token), '--type', 'docx',
          '--comment-id', requireNumericId(commentId, 'comment id'), '--content', content],
        binary,
        runner,
      )
      const data = recordOf(recordOf(result.value)?.['data'])
      // Success only on positive proof of a created reply; anything else may
      // or may not have reached the platform and is never retried.
      return result.ok && data?.['created'] === true ? 'success' : 'unknown'
    },

    async addWholeComment(token, mentionOpenId, text) {
      const content = JSON.stringify([
        { type: 'mention_user', text: requireOpenId(mentionOpenId, 'comment mention') },
        { type: 'text', text: ` ${requireInput(text, 'comment text')}` },
      ])
      let result: CliJsonResult
      try {
        result = await callJson(
          ['drive', '+add-comment', '--as', 'bot', '--doc', requireDocToken(token), '--type', 'docx',
            '--full-comment', '--content', content],
          binary,
          runner,
        )
      } catch {
        return 'unknown'
      }
      const data = recordOf(recordOf(result.value)?.['data'])
      const commentId = data?.['comment_id']
      return result.ok && typeof commentId === 'string' && /^[0-9]+$/.test(commentId) ? 'success' : 'unknown'
    },

    async reactCommentReply(token, replyId, emoji, action) {
      const result = await callJson(
        ['drive', '+react-reply', '--as', 'bot', '--token', requireDocToken(token), '--type', 'docx',
          '--reply-id', requireNumericId(replyId, 'reply id'), '--emoji', emoji, '--action', action],
        binary,
        runner,
      )
      if (!result.ok || recordOf(result.value)?.['ok'] !== true) throw new Error('comment reaction failed')
    },

    async contactName(openId) {
      const data = await callCli(
        ['contact', '+get-user', '--as', 'bot', '--user-id', requireOpenId(openId, 'open id'), '--user-id-type', 'open_id'],
        binary,
        runner,
      )
      const user = recordOf(recordOf(data)?.['user'])
      const name = user?.['name']
      return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined
    },

    async inspectDoc(token) {
      const data = await callCli(
        ['drive', '+inspect', '--as', 'bot', '--url', requireDocToken(token), '--type', 'docx'],
        binary,
        runner,
      )
      const record = recordOf(data)
      if (record === undefined) return undefined
      const title = typeof record['title'] === 'string' && record['title'].trim() !== '' ? record['title'] : undefined
      const url = typeof record['url'] === 'string' && /^https:\/\/[^\s]+$/.test(record['url']) ? record['url'] : undefined
      return { ...(title === undefined ? {} : { title }), ...(url === undefined ? {} : { url }) }
    },

    async fetchDocMarkdown(token) {
      const result = await callJson(
        // lark-cli v1.0.97 docs_fetch_v2.go: `--doc-format markdown`, body at data.document.content.
        ['docs', '+fetch', '--as', 'bot', '--doc', requireDocToken(token), '--doc-format', 'markdown'],
        binary,
        runner,
      )
      const envelope = recordOf(result.value)
      const data = recordOf(envelope?.['data'])
      const markdown = recordOf(data?.['document'])?.['content']
      if (result.ok && envelope?.['ok'] === true && typeof markdown === 'string') return { ok: true, markdown }
      const error = recordOf(envelope?.['error'])
      const code = error?.['code'] ?? error?.['subtype']
      return { ok: false, ...(code === undefined ? {} : { code: String(code) }) }
    },

    async botReady() {
      // `auth status` answers at the TOP LEVEL, not inside the usual `data`
      // envelope, so the ordinary reader would find nothing here.
      // See docs/architecture/dsh-plugin-integration-pitfalls.md §3.
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
      const result = await readUserAuthStatus(binary, runner)
      if (!result.ok) {
        return {
          kind: 'unavailable',
          diagnostic: '无法验证 dsh-pet 专属 lark-cli profile 的当前用户身份。',
        }
      }
      return parseUserIdentity(result.value, expectedAppId)
    },

    async defaultQaOwner(expectedAppId, allowOpenIds) {
      const result = await readUserAuthStatus(binary, runner)
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
    async resolveMemberName(chatId, openId) {
      const wanted = openId.trim()
      if (wanted === '') return undefined
      try {
        const members = await memberList(chatId)
        return members?.find(member => member.openId === wanted)?.name
      } catch {
        // A name is presentation: an unresolvable one leaves the prompt with the
        // open id alone, exactly as before this method existed.
        return undefined
      }
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

    async replyToTarget(target, text) {
      const targetChatId = requireChatId(target.chatId, 'reply target')
      if (target.threadId !== undefined) requireInput(target.threadId, 'reply target thread id')
      const targetMessageId = requireMessageId(
        requireInput(target.messageId, 'reply target message id'),
        'reply target',
      )
      const replyText = await renderReplyMentions(targetChatId, requireInput(text, 'reply text'))
      const args = [
        'im',
        '+messages-reply',
        '--as',
        'bot',
        '--message-id',
        targetMessageId,
        '--text',
        replyText,
      ]
      // A thread id is Host-verified context. The CLI flag is still required
      // to select the platform's thread reply path; retaining the id in the
      // target is not itself proof that this request stays in the topic.
      if (target.threadId !== undefined) args.push('--reply-in-thread')
      args.push('--json')
      const result = await callJson(args, binary, runner)
      const data = recordOf(strictEnvelopeData(result, 'reply to target'))
      const messageId = requireMessageId(data?.['message_id'], 'reply to target')
      const returnedChatId = requireChatId(data?.['chat_id'], 'reply to target')
      if (returnedChatId !== targetChatId) {
        throw new Error('reply to target: lark-cli returned a different chat id')
      }
      return { messageId }
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
      const members = await memberList(chatId)
      return members === undefined ? undefined : members.length
    },

    async listChatMembers(chatId) {
      return memberList(chatId)
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
