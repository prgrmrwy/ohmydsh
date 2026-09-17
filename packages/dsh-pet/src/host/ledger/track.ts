/**
 * Caller-bound `pet_locus_track` — the todo-registration tool's execution
 * logic.
 *
 * Spec: `pet-locus-intent-triage`, requirement "待办登记固定来源与回复去向且
 * 关联标识而非实例". Design D6: a todo references locus IDENTITY, never a
 * locus INSTANCE.
 *
 * Deliberately reuses the SAME authorization shape `pet_locus_finish`/
 * `pet_locus_wait` already use (`PetLocusLifecycleDependencies` in
 * `tools.ts`), rather than this change's own `resolveLedgerCaller` — a
 * `LocusCurrentDelivery` already proves the stronger invariant this tool
 * actually needs ("no唯一 current Delivery 时拒绝登记"), and its
 * `messageId`/`endpoint`/`locusId`/`generation`/`senderOpenId` are EXACTLY
 * the facts spec requires the registration to fix. Re-deriving them through
 * a second, weaker resolver would duplicate — and could drift from — an
 * invariant `pet_locus_finish` already enforces.
 */
import type { LocusContextRecord, LocusCurrentDelivery } from '../locus/context-repository.js'
import { LedgerStoreError, type SharedFactLedgerStore } from './store.js'
import type { NewTodoInput, TodoRecord } from './todo.js'

/** What this module needs to actually register a todo. */
export interface TrackDeps {
  readonly store: Pick<SharedFactLedgerStore, 'registerTodoItem'>
  readonly now: () => number
  readonly newItemId: () => string
}

export type TrackInput = { readonly summary: string; readonly detail: string }

export type TrackResult =
  | { readonly ok: true; readonly record: TodoRecord }
  | { readonly ok: false; readonly reason: 'no-current-delivery' | 'invalid-evidence' | 'store-error'; readonly detail?: string }

/**
 * Register one todo from the caller-bound authorized locus context.
 *
 * `authorized` MUST already be the result of the SAME `authorizeCurrentDelivery`
 * flow `pet_locus_finish`/`pet_locus_wait` use — this function performs no
 * caller resolution of its own, matching those tools' division of labor
 * (`tools.ts`'s `resolveAuthorized` proves the caller/delivery pair; the tool
 * body only acts on the proven result). A record with no `currentDelivery`
 * means there is no唯一 current Delivery to attribute this registration to,
 * and registration is refused rather than falling back to a locus-only
 * identity — spec: "无唯一 current 时拒绝登记，不创建待办，也不猜测目标".
 */
export async function trackTodo(
  authorized: LocusContextRecord,
  input: TrackInput,
  deps: TrackDeps,
): Promise<TrackResult> {
  const delivery: LocusCurrentDelivery | undefined = authorized.currentDelivery
  if (delivery === undefined) return { ok: false, reason: 'no-current-delivery' }
  if (typeof input.summary !== 'string' || input.summary.trim() === '') {
    return { ok: false, reason: 'invalid-evidence', detail: 'summary must be a non-empty string' }
  }
  if (typeof input.detail !== 'string') {
    return { ok: false, reason: 'invalid-evidence', detail: 'detail must be a string' }
  }

  const registration: NewTodoInput = {
    itemId: deps.newItemId(),
    parentSessionId: authorized.main.sessionId,
    locusId: authorized.locus.locusId,
    generation: authorized.locus.generation,
    endpoint: delivery.endpoint.threadId === undefined
      ? { chatId: delivery.endpoint.chatId }
      : { chatId: delivery.endpoint.chatId, threadId: delivery.endpoint.threadId },
    triggerMessageId: delivery.messageId,
    requestedBy: delivery.senderOpenId ?? 'unknown',
    evidence: { summary: input.summary, detail: input.detail },
    createdAt: deps.now(),
  }

  try {
    const record = await deps.store.registerTodoItem(registration)
    return { ok: true, record }
  } catch (error) {
    if (error instanceof LedgerStoreError) return { ok: false, reason: 'store-error', detail: error.message }
    throw error
  }
}
