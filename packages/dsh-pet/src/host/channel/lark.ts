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

const run = promisify(execFile)

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

/** Bot-identity Lark operations Pet depends on. */
export interface LarkClient {
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
  listChatBots(chatId: string): Promise<readonly LarkChatBot[]>
  /**
   * Reply to a message as the bot.
   * @param messageId - Message being replied to.
   * @param text - Reply body.
   */
  reply(messageId: string, text: string): Promise<void>
}

/** How long any single lark-cli call may take. */
const CALL_TIMEOUT_MS = 20_000

/**
 * Invoke `lark-cli` and parse its JSON envelope.
 * @param args - CLI arguments after the executable.
 * @param binary - lark-cli executable name or path.
 * @returns the parsed `data` payload, or `undefined` on any failure.
 */
async function callEnvelope(args: readonly string[], binary: string): Promise<unknown> {
  try {
    const result = await run(binary, [...args], {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    return JSON.parse(result.stdout)
  } catch {
    return undefined
  }
}

async function callCli(args: readonly string[], binary: string): Promise<unknown> {
  let stdout: string
  try {
    const result = await run(binary, [...args], {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; data?: unknown }
    if (parsed.ok !== true) return undefined
    return parsed.data
  } catch {
    return undefined
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
export function createLarkCliClient(binary = 'lark-cli'): LarkClient {
  return {
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
      const envelope = await callEnvelope(['auth', 'status'], binary)
      const bot = (envelope as { identities?: { bot?: { available?: unknown } } } | undefined)
        ?.identities?.bot
      return bot?.available === true
    },

    async chatName(chatId) {
      const data = await callCli(
        ['im', 'chats', 'get', '--as', 'bot', '--chat-id', chatId],
        binary,
      )
      const name = (data as { name?: unknown } | undefined)?.name
      return typeof name === 'string' && name.trim() !== '' ? name : undefined
    },

    async listChatBots(chatId) {
      const data = await callCli(
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
      )
      const bots = (data as { bots?: unknown } | undefined)?.bots
      if (!Array.isArray(bots)) return []
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
      return parsed
    },

    async reply(messageId, text) {
      await callCli(
        ['im', '+messages-reply', '--as', 'bot', '--message-id', messageId, '--text', text],
        binary,
      )
    },
  }
}
