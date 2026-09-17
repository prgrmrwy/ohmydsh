/**
 * Pure presentation model for the shared-fact-ledger todo view — the
 * management-panel counterpart to `locus-view.ts`, following the same
 * discipline it documents: everything here is a function of a Host snapshot,
 * no fetch, no React, no storage.
 *
 * Spec: `pet-locus-intent-triage`, requirement "管理面呈现待办并提供由固定标
 * 识派生的跳转".
 */

export type TodoJumpTargetKind = 'feishu' | 'session'

/** One durable todo item as the Host snapshot reports it — the shape the panel actually reads. */
export interface TodoSnapshotItem {
  readonly itemId: string
  readonly locusId: string
  readonly endpoint: { readonly chatId: string; readonly threadId?: string }
  readonly triggerMessageId: string
  readonly requestedBy: string
  readonly summary: string
  readonly detail: string
  readonly status: 'open' | 'accepted' | 'done' | 'dropped'
  readonly createdAt: number
  readonly statusChangedAt: number
}

/** Whether the panel can prove a stable topic (thread) identity for this endpoint. */
function hasProvenThreadIdentity(endpoint: TodoSnapshotItem['endpoint']): boolean {
  return typeof endpoint.threadId === 'string' && endpoint.threadId.trim() !== ''
}

export type FeishuJumpTarget =
  | { readonly kind: 'thread'; readonly chatId: string; readonly threadId: string; readonly messageId: string }
  | { readonly kind: 'chat-degraded'; readonly chatId: string; readonly messageId: string; readonly reason: string }

/**
 * Decide the Feishu jump TARGET (not the URL itself) for one todo.
 *
 * Spec: "话题指向该话题，无法证明话题身份时 SHALL 退化为所属群并如实说明，
 * MUST NOT 伪造话题目标". This function only decides WHICH kind of target is
 * provable from the snapshot; it does not construct a deep-link URL — that
 * requires an exact external query-parameter format (`applink.feishu.cn/
 * client/thread/open`-shaped, per the production precedent in
 * `docs/notes/pet-locus-spike-findings.md`) that this change has not
 * independently verified against the live platform. Callers must supply
 * their own verified URL builder (see `resolveFeishuJumpUrl`) rather than
 * this module guessing a query-string shape.
 */
export function resolveFeishuJumpTarget(item: TodoSnapshotItem): FeishuJumpTarget {
  if (hasProvenThreadIdentity(item.endpoint)) {
    return {
      kind: 'thread',
      chatId: item.endpoint.chatId,
      threadId: item.endpoint.threadId!,
      messageId: item.triggerMessageId,
    }
  }
  return {
    kind: 'chat-degraded',
    chatId: item.endpoint.chatId,
    messageId: item.triggerMessageId,
    reason: item.endpoint.threadId === undefined
      ? '该待办来自群本体，非话题'
      : '无法证明话题标识，已退化为所属群',
  }
}

/**
 * Build the actual Feishu URL from a resolved target, given a verified
 * builder. Kept separate from `resolveFeishuJumpTarget` so a caller with a
 * confirmed deep-link format can supply it, while a caller without one still
 * gets the correct TARGET decision (thread vs. degraded-to-chat) without this
 * module fabricating a URL shape it cannot verify.
 */
export function resolveFeishuJumpUrl(
  target: FeishuJumpTarget,
  builder: {
    readonly threadUrl: (chatId: string, threadId: string, messageId: string) => string
    readonly chatUrl: (chatId: string, messageId: string) => string
  },
): string {
  return target.kind === 'thread'
    ? builder.threadUrl(target.chatId, target.threadId, target.messageId)
    : builder.chatUrl(target.chatId, target.messageId)
}

export type SessionJumpTarget =
  | { readonly kind: 'available'; readonly sessionId: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Decide whether the "跳会话" jump is available for one todo, given the Host's
 * resolution of the todo's `locusId` to its CURRENT-generation child session
 * (or the absence of one). Reuses the same availability vocabulary
 * `locus-view.ts#isSessionOpenable` already established — archived/missing
 * are not openable, matching the panel's existing session-jump behavior for
 * ordinary locus rows.
 */
export function resolveSessionJumpTarget(
  currentChildSessionId: string | undefined,
  availability: 'available' | 'archived' | 'missing' | undefined,
): SessionJumpTarget {
  if (currentChildSessionId === undefined) {
    return { kind: 'unavailable', reason: '该 locus 当前代无子会话，或来源已失效' }
  }
  if (availability === 'archived') return { kind: 'unavailable', reason: '会话已归档' }
  if (availability === 'missing') return { kind: 'unavailable', reason: '会话不可用' }
  return { kind: 'available', sessionId: currentChildSessionId }
}

/** Owner-facing status label — Chinese, matching `locus-view.ts`'s existing vocabulary style. */
export function todoStatusLabel(status: TodoSnapshotItem['status']): string {
  return { open: '待处理', accepted: '已受理', done: '已完成', dropped: '已放弃' }[status]
}

/** Whether a todo's status can still be advanced by the owner (matches `ledger/todo.ts#isTodoTerminal`, inverted). */
export function isTodoActionable(status: TodoSnapshotItem['status']): boolean {
  return status === 'open' || status === 'accepted'
}

/** Which owner actions are legal from the CURRENT status, mirroring `ledger/todo.ts#TODO_STATUS_TRANSITIONS` for the panel's button set. */
export function availableTodoActions(status: TodoSnapshotItem['status']): readonly ('accept' | 'done' | 'drop')[] {
  if (status === 'open') return ['accept', 'done', 'drop']
  if (status === 'accepted') return ['done', 'drop']
  return []
}

/**
 * Group a flat list of todos by their source endpoint's locus, for the
 * "按来源入口与状态呈现" requirement. Grouping key is `locusId` — the same
 * identity-not-instance principle `ledger/todo.ts` design D6 established, so
 * items registered under different generations of the SAME locus still group
 * together, matching `listByLocusId`'s behavior at the store layer.
 */
export function groupTodosByLocus(
  items: readonly TodoSnapshotItem[],
): ReadonlyMap<string, readonly TodoSnapshotItem[]> {
  const groups = new Map<string, TodoSnapshotItem[]>()
  for (const item of items) {
    const existing = groups.get(item.locusId)
    if (existing === undefined) groups.set(item.locusId, [item])
    else existing.push(item)
  }
  return groups
}
