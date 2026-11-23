/**
 * Topic (thread) list reader for change `locus-read-referenced-chats`
 * (design D6, spec "话题分页合约与终止" / "话题列表失败的回退与去重", tasks 8).
 *
 * Pure logic over an INJECTED runner: it never spawns a process, never touches
 * `media.ts`, and keeps no state of its own. The caller (media.ts) owns the
 * snapshot table (D7) and stores {@link TopicReaderState} in its `topic` field.
 *
 * ## Exported contract (core wires against exactly this)
 *
 * ```ts
 * type TopicRunner = (args: readonly string[], signal?: AbortSignal) => Promise<TopicRunnerResult>
 * type TopicRunnerResult =
 *   | { ok: true; envelope: unknown }                  // parsed stdout JSON (the whole lark-cli envelope)
 *   | { ok: false; code?: string; detail?: string }    // D4: failure envelope code from stdout-then-stderr,
 *                                                      // or no code for timeout / 5xx / exec error
 *
 * interface TopicReaderState {          // immutable; the snapshot's `topic` field
 *   pageToken?: string                  // token of the NEXT page; absent before the first page
 *   pageIndex: number                   // 1-based ordinal of the page the next call reads
 *   emptyStreak: number                 // consecutive empty pages so far
 *   seenTokens: readonly string[]       // every page_token returned so far in this read
 *   attempt: number                     // failed attempts at this position (0..2)
 * }
 * const initialTopicState: TopicReaderState
 *
 * interface TopicMessage {
 *   messageId; msgType; createTime; senderName?; content;
 *   position: number                    // thread_message_position (-1 = root)
 *   linked: boolean                     // messageId === linkedMessageId ("链接所指", marked once)
 *   deleted: boolean
 * }
 *
 * readTopicPage(input: {
 *   runner: TopicRunner; threadId: string; chatId: string;   // chatId = source group (chat_info.chat_id)
 *   linkedMessageId: string; state: TopicReaderState; signal?: AbortSignal
 * }): Promise<TopicPageResult>
 *
 * type TopicPageResult =
 *   // a valid page. `done` => no more pages (has_more=false, or the read ended terminally with `failed`).
 *   // When `failed` is set the read is OVER: no cursor, complete=false; `messages` still deliver.
 *   | { kind: 'page'; messages: TopicMessage[]; state: TopicReaderState; done: boolean;
 *       failed?: { id: string; reason: string } }
 *   // transient failure, attempt 1 or 2: nothing delivered, `failed` stays empty; core re-issues a cursor at
 *   // the same position carrying `state` (attempt already +1) and writes `diagnostic` into the text.
 *   | { kind: 'retry'; state: TopicReaderState; diagnostic: string }
 *   // first page cannot be listed (final failure, or 3rd transient): core falls back to a SINGLE read of the
 *   // linked message (kind `single`, continuable) and records `failed` (id `topic-list`); no topic cursor.
 *   | { kind: 'fallback'; failed: { id: 'topic-list'; reason: string } }
 *   // a later page failed finally / 3rd transient / page invalid: pages already read stay delivered;
 *   // read ends, no cursor; `failed.id` is `topic-page@<pageIndex>`.
 *   | { kind: 'stopped'; failed: { id: string; reason: string } }
 * ```
 *
 * `reason` is the platform code (`230002`), `envelope-invalid(topic-item-foreign)`,
 * `envelope-invalid(topic-position-order)`, `envelope-invalid(topic-page-malformed)`,
 * `pagination-loop`, `pagination-stalled`, or `transient(<detail>)` for a 3rd transient failure.
 *
 * Out of scope here (core): per-message raw read and download for topic items (own id), merge-forward
 * expansion, unit packing, cursor issuing.
 *
 * @module
 */

/** Result of one injected CLI call. */
export type TopicRunnerResult =
  | { readonly ok: true; readonly envelope: unknown }
  | { readonly ok: false; readonly code?: string; readonly detail?: string }

/** Injected CLI runner: receives the argv AFTER the binary and profile prefix. */
export type TopicRunner = (args: readonly string[], signal?: AbortSignal) => Promise<TopicRunnerResult>

/** Continuation state of one topic read (stored by the caller's snapshot). */
export interface TopicReaderState {
  readonly pageToken?: string
  readonly pageIndex: number
  readonly emptyStreak: number
  readonly seenTokens: readonly string[]
  readonly attempt: number
}

export const initialTopicState: TopicReaderState = {
  pageIndex: 1,
  emptyStreak: 0,
  seenTokens: [],
  attempt: 0,
}

/** One validated list item. */
export interface TopicMessage {
  readonly messageId: string
  readonly msgType: string
  readonly createTime: string
  readonly senderName?: string
  readonly content: string
  readonly position: number
  readonly linked: boolean
  readonly deleted: boolean
}

export interface ReadTopicPageInput {
  readonly runner: TopicRunner
  readonly threadId: string
  readonly chatId: string
  readonly linkedMessageId: string
  readonly state: TopicReaderState
  readonly signal?: AbortSignal
}

export type TopicPageResult =
  | {
    readonly kind: 'page'
    readonly messages: readonly TopicMessage[]
    readonly state: TopicReaderState
    readonly done: boolean
    readonly failed?: { readonly id: string; readonly reason: string }
  }
  | { readonly kind: 'retry'; readonly state: TopicReaderState; readonly diagnostic: string }
  | { readonly kind: 'fallback'; readonly failed: { readonly id: 'topic-list'; readonly reason: string } }
  | { readonly kind: 'stopped'; readonly failed: { readonly id: string; readonly reason: string } }

/** Platform codes that no retry can fix (invalid token, no access, missing scope). */
const FINAL_CODES: ReadonlySet<string> = new Set(['230001', '230002', '99991672'])

/** Third failure at the same position is final (design D8). */
const MAX_ATTEMPTS = 3
/** Consecutive empty pages that end the read (design D6). */
const MAX_EMPTY_STREAK = 3

const PAGE_MALFORMED = 'envelope-invalid(topic-page-malformed)'

type Failure =
  | { readonly final: true; readonly reason: string }
  | { readonly final: false; readonly detail: string }

function failureOf(result: TopicRunnerResult): Failure | undefined {
  if (!result.ok) {
    return result.code !== undefined && FINAL_CODES.has(result.code)
      ? { final: true, reason: result.code }
      : { final: false, detail: result.code ?? result.detail ?? 'unknown' }
  }
  const envelope = result.envelope as { ok?: unknown; error?: { code?: unknown } } | null
  if (typeof envelope !== 'object' || envelope === null) return { final: true, reason: PAGE_MALFORMED }
  if (envelope.ok === true) return undefined
  const raw = envelope.error?.code
  const code = typeof raw === 'number' || typeof raw === 'string' ? String(raw) : undefined
  return code !== undefined && FINAL_CODES.has(code)
    ? { final: true, reason: code }
    : { final: false, detail: code ?? 'unknown' }
}

function parsePosition(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) ? n : undefined
}

/** A page that cannot be used: the first page falls back, a later one ends the read. */
function failPage(state: TopicReaderState, reason: string): TopicPageResult {
  return state.pageIndex === 1
    ? { kind: 'fallback', failed: { id: 'topic-list', reason } }
    : { kind: 'stopped', failed: { id: `topic-page@${String(state.pageIndex)}`, reason } }
}

interface ParsedPage {
  readonly messages: TopicMessage[]
  readonly hasMore: boolean
  readonly pageToken: string | undefined
}

/** Validates the page contract; returns the failure reason when it is not met. */
function parsePage(envelope: unknown, input: ReadTopicPageInput): ParsedPage | string {
  const data = (envelope as { data?: Record<string, unknown> }).data
  if (typeof data !== 'object' || data === null) return PAGE_MALFORMED
  const raw = data['messages']
  if (!Array.isArray(raw)) return PAGE_MALFORMED
  const messages: TopicMessage[] = []
  let previous: number | undefined
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return PAGE_MALFORMED
    const item = entry as Record<string, unknown>
    if (item['chat_id'] !== input.chatId || item['thread_id'] !== input.threadId) {
      return 'envelope-invalid(topic-item-foreign)'
    }
    const messageId = item['message_id']
    const position = parsePosition(item['thread_message_position'])
    if (typeof messageId !== 'string' || messageId === '' || position === undefined) return PAGE_MALFORMED
    if (previous !== undefined && position <= previous) return 'envelope-invalid(topic-position-order)'
    previous = position
    const sender = item['sender'] as { name?: unknown } | undefined
    messages.push({
      messageId,
      msgType: typeof item['msg_type'] === 'string' ? item['msg_type'] : '',
      createTime: typeof item['create_time'] === 'string' ? item['create_time'] : '',
      ...(typeof sender?.name === 'string' && sender.name !== '' ? { senderName: sender.name } : {}),
      content: typeof item['content'] === 'string' ? item['content'] : '',
      position,
      linked: messageId === input.linkedMessageId,
      deleted: item['deleted'] === true,
    })
  }
  const hasMore = data['has_more'] === true
  const token = data['page_token']
  const pageToken = typeof token === 'string' && token !== '' ? token : undefined
  if (hasMore && pageToken === undefined) return PAGE_MALFORMED
  return { messages, hasMore, pageToken }
}

/** Reads exactly one platform page of the topic. */
export async function readTopicPage(input: ReadTopicPageInput): Promise<TopicPageResult> {
  const { state } = input
  const args = [
    'im', '+threads-messages-list', '--thread', input.threadId, '--as', 'bot',
    '--order', 'asc', '--page-size', '50', '--no-reactions', '--format', 'json',
    ...(state.pageToken === undefined ? [] : ['--page-token', state.pageToken]),
  ]
  const result = await input.runner(args, input.signal)
  const failure = failureOf(result)
  if (failure !== undefined) {
    if (failure.final) return failPage(state, failure.reason)
    const attempt = state.attempt + 1
    if (attempt >= MAX_ATTEMPTS) return failPage(state, `transient(${failure.detail})`)
    const label = state.pageIndex === 1 ? 'topic-list' : `topic-page@${String(state.pageIndex)}`
    return {
      kind: 'retry',
      state: { ...state, attempt },
      diagnostic: `${label} transient failure (attempt ${String(attempt)}): ${failure.detail}`,
    }
  }
  const parsed = parsePage((result as { envelope: unknown }).envelope, input)
  if (typeof parsed === 'string') return failPage(state, parsed)

  const emptyStreak = parsed.messages.length === 0 ? state.emptyStreak + 1 : 0
  const nextIndex = state.pageIndex + 1
  const ended = (failed?: { id: string; reason: string }): TopicPageResult => ({
    kind: 'page',
    messages: parsed.messages,
    state: { ...state, emptyStreak, attempt: 0 },
    done: true,
    ...(failed === undefined ? {} : { failed }),
  })
  if (!parsed.hasMore) return ended()
  const token = parsed.pageToken as string
  if (state.seenTokens.includes(token)) {
    return ended({ id: `topic-page@${String(nextIndex)}`, reason: 'pagination-loop' })
  }
  if (emptyStreak >= MAX_EMPTY_STREAK) {
    return ended({ id: `topic-page@${String(state.pageIndex)}`, reason: 'pagination-stalled' })
  }
  return {
    kind: 'page',
    messages: parsed.messages,
    state: {
      pageToken: token,
      pageIndex: nextIndex,
      emptyStreak,
      seenTokens: [...state.seenTokens, token],
      attempt: 0,
    },
    done: false,
  }
}
