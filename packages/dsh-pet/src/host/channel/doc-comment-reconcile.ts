/**
 * Doc-comment reconciliation fallback (openspec pet-locus-doc-comments).
 *
 * Feishu delivers `drive.notice.comment_add_v1` on a best-effort basis: a
 * comment that @-mentions the bot can still fail to produce an event. Live
 * evidence (2026-11-13): every comment authored by the document owner produced
 * an event, every comment authored by a reviewer produced none, while IM events
 * on the same connection kept arriving.
 *
 * This driver re-reads recent comments of documents that ALREADY have a usable
 * locus entry and runs the SAME admission path for replies that @ this bot but
 * never became a Delivery. It also makes the live path more likely to work at
 * all: the first pass over a document subscribes THIS app to that document's
 * notification events (`POST /drive/v1/files/:token/subscribe`), which is the
 * other official prerequisite for receiving comment notices. Both are bounded
 * catch-ups, not a second intake:
 *
 * - the same `doc:docx:<token>/<comment>/<reply>` message id feeds the durable
 *   Delivery index, so a live/reconcile race loses one accept as `duplicate`;
 * - only entries the owner already opted into are scanned (`doc:docx:` roots);
 * - per pass: at most `maxDocsPerTick` documents round-robin, at most
 *   `maxPagesPerDoc` pages each, and only replies newer than the document's
 *   last handed-through Delivery (or the startup lookback when there is none);
 * - the document subscription is attempted once per document and process,
 *   then retried at most every `subscribeRetryMs` while it keeps failing;
 * - read failures, refusals and cancellations become diagnostics only; they
 *   never touch live intake and never throw into the channel.
 *
 * @module
 */

import type { DocCommentsPage, DocCommentQuery, DocEventSubscription, LarkClient } from './lark.js'
import { admitDocCommentEvent, type DocCommentEvent } from './doc-comment.js'
import type { LocusControllerResult, NormalizedLocusAdmission } from './locus-controller.js'
import type { LocusAdmissionContext } from '../locus/admission.js'
import { parseDocChatId } from '../locus/doc-endpoint.js'

/** Fixed bounds. A test may override them through `limits`. */
export const DOC_RECONCILE = {
  intervalMs: 60_000,
  /** Let startup (binding, provisioning, first events) settle before the first pass. */
  startupDelayMs: 15_000,
  /** First-scan window for a document the bot has never handled anything on. */
  startupLookbackMs: 10 * 60_000,
  /** Minimum gap between subscription attempts for one document that keeps failing. */
  subscribeRetryMs: 10 * 60_000,
  maxDocsPerTick: 3,
  maxPagesPerDoc: 2,
} as const

/** What one pass reports, for Host diagnostics only. */
export type DocReconcileOutcome =
  | { readonly kind: 'admitted'; readonly documents: number; readonly comments: number }
  | { readonly kind: 'refused'; readonly documents: number; readonly comments: number }
  | { readonly kind: 'list-failed'; readonly documents: number }
  | { readonly kind: 'subscribed'; readonly documents: number }
  | {
      readonly kind: 'subscribe-failed'
      readonly documents: number
      readonly reason: Exclude<DocEventSubscription, 'success'>
    }

/** Dependencies of {@link createDocCommentReconciler}. */
export interface DocReconcileDeps {
  readonly client: Pick<LarkClient, 'listDocComments' | 'subscribeDocEvents'>
  /** `doc:docx:<token>` roots the Host currently serves; scanned round-robin. */
  readonly entries: () => readonly string[]
  /** The doc's last Delivery `acceptedAt`, so catch-up starts after handled work. */
  readonly handledThrough: (chatId: string) => number | undefined
  /** The live admission context; only its watermark is overridden to 0. */
  readonly admissionContext: () => LocusAdmissionContext | undefined
  readonly handleAdmission: (admission: NormalizedLocusAdmission) => Promise<LocusControllerResult>
  /** Whether the formal channel is still running; checked after every await. */
  readonly active: () => boolean
  /** Aborted when the channel stops or is disabled. */
  readonly signal: () => AbortSignal
  readonly onOutcome?: (outcome: DocReconcileOutcome) => void
  readonly now?: () => number
  readonly schedule?: (run: () => void, delayMs: number) => { cancel(): void }
  readonly limits?: Partial<typeof DOC_RECONCILE>
}

/** The reconciler handle; `tick` is exposed so tests never wait on timers. */
export interface DocCommentReconciler {
  start(): void
  stop(): void
  tick(): Promise<void>
}

function defaultSchedule(run: () => void, delayMs: number): { cancel(): void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/**
 * Build the bounded reconciliation driver.
 * @param deps - Lark read, live admission and lifecycle seams.
 * @returns a startable/stopable driver that never throws.
 */
export function createDocCommentReconciler(deps: DocReconcileDeps): DocCommentReconciler {
  const limits = { ...DOC_RECONCILE, ...deps.limits }
  const now = deps.now ?? Date.now
  const schedule = deps.schedule ?? defaultSchedule
  /** chatId → newest reply create time already scanned (ms). */
  const cursors = new Map<string, number>()
  /** chatIds whose document event subscription already succeeded in this process. */
  const subscribed = new Set<string>()
  /** chatId → when its last subscription attempt failed (ms). */
  const subscribeFailedAt = new Map<string, number>()
  let nextDocument = 0
  let timer: { cancel(): void } | undefined
  let running = false
  let stopped = true

  const report = (outcome: DocReconcileOutcome): void => {
    try {
      deps.onOutcome?.(outcome)
    } catch {
      // Diagnostics never break the driver.
    }
  }

  const stoppedNow = (): boolean => !deps.active() || deps.signal().aborted

  async function tick(): Promise<void> {
    // `tick` is also the manual/diagnostic entry: only lifecycle stop and the
    // channel's own inactive state suppress it, never the scheduling flag.
    if (running || stoppedNow()) return
    running = true
    try {
      const context = deps.admissionContext()
      const botOpenId = context?.botOpenId
      if (context === undefined || botOpenId === undefined) return
      const list = deps.client.listDocComments
      if (list === undefined) return
      const entries = deps.entries()
      if (entries.length === 0) return

      const count = Math.min(limits.maxDocsPerTick, entries.length)
      let admitted = 0
      let refused = 0
      let listFailed = false
      let subscribeSucceeded = 0
      const subscribeFailures: Exclude<DocEventSubscription, 'success'>[] = []
      for (let offset = 0; offset < count; offset += 1) {
        if (stoppedNow()) return
        const chatId = entries[(nextDocument + offset) % entries.length]!
        const token = parseDocChatId(chatId)
        if (token === undefined) continue
        // The other official prerequisite for live comment events: the app must
        // be subscribed to THIS document's notices. Bind → first pass subscribes.
        const subscribe = deps.client.subscribeDocEvents
        if (subscribe !== undefined && !subscribed.has(chatId)) {
          const failedAt = subscribeFailedAt.get(chatId)
          if (failedAt === undefined || now() - failedAt >= limits.subscribeRetryMs) {
            let result: DocEventSubscription
            try {
              result = await subscribe.call(deps.client, token)
            } catch {
              result = 'unknown'
            }
            if (stoppedNow()) return
            if (result === 'success') {
              subscribed.add(chatId)
              subscribeFailedAt.delete(chatId)
              subscribeSucceeded += 1
            } else {
              subscribeFailedAt.set(chatId, now())
              subscribeFailures.push(result)
            }
          }
        }
        const cursor = cursors.get(chatId)
          ?? deps.handledThrough(chatId)
          ?? now() - limits.startupLookbackMs
        let newest = cursor
        let pageToken: string | undefined
        let pages = 0
        while (pages < limits.maxPagesPerDoc) {
          pages += 1
          let page: DocCommentsPage | undefined
          try {
            page = await list.call(deps.client, token, pageToken)
          } catch {
            page = undefined
          }
          if (stoppedNow()) return
          if (page === undefined) {
            listFailed = true
            break
          }
          for (const card of page.comments) {
            for (const reply of card.replies) {
              if (reply.authorOpenId === undefined || reply.authorOpenId === '' || reply.authorOpenId === botOpenId) continue
              if (reply.mentionOpenIds === undefined || !reply.mentionOpenIds.includes(botOpenId)) continue
              const createdAt = reply.createdAt
              // A reply with no create time cannot be bounded; skip it rather
              // than replaying history on every pass.
              if (createdAt === undefined || createdAt <= cursor) continue
              if (createdAt > newest) newest = createdAt
              const event: DocCommentEvent = {
                token,
                fileType: 'docx',
                commentId: card.commentId,
                replyId: reply.replyId,
                isMentioned: true,
                senderOpenId: reply.authorOpenId,
                isFromAgent: false,
                createdAt,
              }
              const query: DocCommentQuery = {
                kind: 'ok',
                isWhole: card.isWhole,
                ...(card.quote === undefined ? {} : { quote: card.quote }),
                replies: card.replies,
                trigger: reply,
              }
              // The live subscription watermark must not reject a comment this
              // catch-up exists to recover; every other rule is unchanged.
              const admission = admitDocCommentEvent(event, query, { ...context, watermark: 0 })
              if (admission.kind === 'rejected') {
                refused += 1
                continue
              }
              const result = await deps.handleAdmission(admission)
              if (stoppedNow()) return
              if (result.kind === 'accepted') admitted += 1
              else refused += 1
            }
          }
          if (page.hasMore && page.pageToken !== undefined) pageToken = page.pageToken
          else break
        }
        if (newest > cursor) cursors.set(chatId, newest)
      }
      nextDocument = (nextDocument + count) % entries.length
      if (admitted > 0) report({ kind: 'admitted', documents: count, comments: admitted })
      if (refused > 0) report({ kind: 'refused', documents: count, comments: refused })
      if (listFailed) report({ kind: 'list-failed', documents: count })
      if (subscribeSucceeded > 0) report({ kind: 'subscribed', documents: subscribeSucceeded })
      for (const reason of new Set(subscribeFailures)) {
        report({ kind: 'subscribe-failed', documents: subscribeFailures.length, reason })
      }
    } finally {
      running = false
    }
  }

  const runOnce = (): void => {
    if (stoppedNow()) return
    void tick().catch(() => undefined)
    if (stoppedNow()) return
    timer = schedule(runOnce, limits.intervalMs)
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      timer = schedule(runOnce, limits.startupDelayMs)
    },
    stop() {
      stopped = true
      timer?.cancel()
      timer = undefined
    },
    tick,
  }
}
