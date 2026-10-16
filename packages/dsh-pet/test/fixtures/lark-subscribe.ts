/**
 * Redacted samples of REAL `lark-cli event +subscribe --compact` output and
 * the drive comment APIs, captured during the pet-locus-doc-comments spike
 * (2026-10-16, lark-cli 1.0.97, throwaway app — never the production bot).
 *
 * Why these exist: see `real-lark-events.ts` and pitfalls §4 — event shapes
 * must be measured. The compact IM shape is the same mapping `event consume`
 * emits (lark-cli v1.0.97 `processor_im_message.go` / `message_receive.go`);
 * drive events go through `processor_generic.go`, which flattens `event` one
 * level and adds `type` / `event_id` / `timestamp` while keeping
 * `notice_meta` nested.
 *
 * Redaction rule (same as `real-lark-events.ts`): identifier bodies are
 * replaced with fixed synthetic bodies of the same length and alphabet;
 * structure, prefixes and field sets are preserved. No real chat, user,
 * document, comment, tenant, token or secret survives here.
 *
 * @module
 */

/** Synthetic identifiers with the observed shapes. */
export const DOC_IDS = {
  /** docx obj token: 27 alphanumerics. */
  docToken: 'Dx0000000000000000000000001',
  /** A second document, for cross-document isolation. */
  otherDocToken: 'Dx0000000000000000000000002',
  /** comment_id: 19-digit time-ordered number. */
  wholeCommentId: '7696944560311651569',
  anchoredCommentId: '7696944637407137026',
  /** Two anchored comments sharing a 9-digit prefix (short-code collision case). */
  sameprefixA: '7696945640885996815',
  sameprefixB: '7696945648012135660',
  /** reply_id values. */
  wholeRootReplyId: '7696944560332606724',
  anchoredRootReplyId: '7696944637432302886',
  anchoredFollowupReplyId: '7696944764314193153',
  /** Open ids: `ou_` + 32 hex. */
  ownerOpenId: 'ou_00000000000000000000000000000a01',
  otherUserOpenId: 'ou_00000000000000000000000000000a02',
  botOpenId: 'ou_00000000000000000000000000000b01',
  groupChatId: 'oc_00000000000000000000000000000c01',
} as const

/** One compact `im.message.receive_v1` line, exactly as `+subscribe --compact` prints it. */
export function compactImMessage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'im.message.receive_v1',
    event_id: '00000000000000000000000000000e01',
    timestamp: '1792084762401',
    id: 'om_x100b0000000000000000000000001',
    message_id: 'om_x100b0000000000000000000000001',
    create_time: '1792084762119',
    chat_id: DOC_IDS.groupChatId,
    chat_type: 'group',
    message_type: 'text',
    sender_id: DOC_IDS.ownerOpenId,
    sender_type: 'user',
    content: '@pet hi',
    mentions: [{ key: '@_user_1', id: DOC_IDS.botOpenId, name: 'pet' }],
    ...overrides,
  })
}

/**
 * An `interactive` card under `--compact`: the processor returns the RAW v2
 * envelope (no top-level message_id / chat_id), see lark-cli
 * `processor_im_message.go` L61-66.
 */
export function compactInteractiveEnvelope(): string {
  return JSON.stringify({
    schema: '2.0',
    header: {
      event_id: '00000000000000000000000000000e02',
      event_type: 'im.message.receive_v1',
      create_time: '1792084762401',
    },
    event: {
      message: {
        chat_id: DOC_IDS.groupChatId,
        chat_type: 'group',
        message_id: 'om_x100b0000000000000000000000002',
        message_type: 'interactive',
        content: '{}',
      },
      sender: { sender_id: { open_id: DOC_IDS.ownerOpenId }, sender_type: 'user' },
    },
  })
}

/** Inputs for one compact `drive.notice.comment_add_v1` line. */
export interface CommentEventInput {
  readonly fileToken?: string
  readonly fileType?: string
  readonly commentId?: string
  readonly replyId?: string
  readonly noticeType?: 'add_comment' | 'add_reply'
  readonly isMentioned?: boolean
  readonly fromOpenId?: string
  readonly fromUserType?: string
  readonly isFromAgent?: boolean
  readonly timestamp?: string
  readonly eventId?: string
}

/** One compact comment event line, in the GenericProcessor shape. */
export function compactCommentEvent(input: CommentEventInput = {}): string {
  return JSON.stringify({
    comment_id: input.commentId ?? DOC_IDS.wholeCommentId,
    is_mentioned: input.isMentioned ?? true,
    notice_meta: {
      file_token: input.fileToken ?? DOC_IDS.docToken,
      file_type: input.fileType ?? 'docx',
      from_user_id: { open_id: input.fromOpenId ?? DOC_IDS.ownerOpenId, union_id: 'on_0000', user_id: '00000000' },
      from_user_tenant_key: '0000000000000000',
      from_user_type: input.fromUserType ?? 'user',
      is_from_agent: input.isFromAgent ?? false,
      notice_type: input.noticeType ?? 'add_comment',
      to_user_id: { open_id: DOC_IDS.botOpenId, union_id: 'on_0001', user_id: '' },
    },
    reply_id: input.replyId ?? DOC_IDS.wholeRootReplyId,
    visibility: 'public',
    type: 'drive.notice.comment_add_v1',
    event_id: input.eventId ?? '00000000000000000000000000000e10',
    timestamp: input.timestamp ?? '1792084556000',
  })
}

/** stderr lines `+subscribe` writes, as observed. The SDK line carries credentials. */
export const SUBSCRIBE_STDERR = {
  connecting: '\u001b[36mConnecting to Lark event WebSocket...\u001b[0m\n',
  listening: 'Listening for: \u001b[32mdrive.notice.comment_add_v1, im.message.receive_v1\u001b[0m\n',
  /** Printed once, BEFORE the handshake: not proof of a connection. */
  connectedBanner: '\u001b[1m\u001b[32mConnected.\u001b[0m Waiting for events... (Ctrl+C to stop)\n',
  /** The real readiness line; query string carries secrets that must never leak. */
  sdkConnected:
    '[SDK Info] connected to wss://msg-frontier.feishu.cn/ws/v2?fpid=493&aid=552564&device_id=0000&access_key=AKSECRETAK&service_id=33554678&ticket=TKSECRETTK [conn_id=0000]\n',
  notFoundHandler:
    '[SDK Error] handle message failed, message_type: event, message_id: 0000, trace_id: 0000, err: event type: im.message.receive_v1, not found handler [conn_id=0000]\n',
  /** Exit-2 body when another +subscribe holds the per-app lock. */
  lockHeld: JSON.stringify(
    {
      ok: false,
      identity: 'bot',
      error: {
        type: 'validation',
        subtype: 'failed_precondition',
        message:
          'another event +subscribe instance is already running for app cli_0000\n  Only one subscriber per app is allowed to prevent competing consumers.\n  Use --force to bypass this check.',
      },
    },
    null,
    2,
  ),
} as const

/** Secrets embedded in {@link SUBSCRIBE_STDERR.sdkConnected}; a leak sentinel. */
export const STDERR_SECRETS = ['AKSECRETAK', 'TKSECRETTK', 'wss://'] as const

/** `drive +batch-query-comments` `data` payloads, shaped as observed. */
export function batchQueryComments(items: readonly Record<string, unknown>[]): Record<string, unknown> {
  return { items }
}

/** One comment card for {@link batchQueryComments}. */
export function commentCard(input: {
  readonly commentId: string
  readonly isWhole: boolean
  readonly quote?: string
  readonly replies: readonly { readonly replyId: string; readonly text: string; readonly mentionBot?: boolean }[]
  readonly hasMore?: boolean
}): Record<string, unknown> {
  return {
    comment_id: input.commentId,
    is_whole: input.isWhole,
    is_solved: false,
    ...(input.quote === undefined ? {} : { quote: input.quote }),
    has_more: input.hasMore ?? false,
    reply_list: {
      replies: input.replies.map(reply => ({
        reply_id: reply.replyId,
        content: {
          elements: [
            ...(reply.mentionBot === false
              ? []
              : [{ type: 'person', person: { user_id: DOC_IDS.botOpenId } }]),
            { type: 'text_run', text_run: { text: ` ${reply.text}` } },
          ],
        },
      })),
    },
  }
}

/** `drive +inspect` `data` payload for a docx. */
export function inspectDoc(token: string, title = '技术方案'): Record<string, unknown> {
  return { title, token, type: 'docx', url: `https://www.feishu.cn/docx/${token}` }
}

/** `GET /open-apis/event/v1/connection` response body. */
/**
 * `lark-cli api GET /open-apis/event/v1/connection --as bot`, exactly as the CLI
 * prints it (captured live from 1.0.97 on 2026-10-17): the CLI wraps the
 * OpenAPI body as `{ ok, identity, data }` and drops the raw `code`/`msg`.
 * An earlier version of this fixture used the raw OpenAPI envelope; the live
 * acceptance run proved no real read ever had that shape.
 */
export function connectionCount(count: number): Record<string, unknown> {
  return { ok: true, identity: 'bot', data: { online_instance_cnt: count } }
}

/** `event consume <key> --dry-run` decision output, per precondition status. */
export function consumeDryRun(statuses: {
  readonly credentials_available?: 'ok' | 'unknown' | 'blocked'
  readonly console_event_published?: 'ok' | 'unknown' | 'blocked'
  readonly scopes_granted?: 'ok' | 'unknown' | 'blocked'
} = {}): Record<string, unknown> {
  const pre = (name: keyof typeof statuses) => ({ name, status: statuses[name] ?? 'ok' })
  return {
    ok: true,
    identity: 'bot',
    dry_run: true,
    data: {
      decision: {
        event_key: 'im.message.receive_v1',
        status: 'ready',
        preconditions: [pre('credentials_available'), pre('console_event_published'), pre('scopes_granted')],
      },
    },
  }
}

/** `docs +fetch --doc-format markdown` envelope (lark-cli v1.0.97 docs_fetch_v2.go). */
export function docsFetchMarkdown(content: string): Record<string, unknown> {
  return { ok: true, identity: 'bot', data: { document: { content } } }
}
