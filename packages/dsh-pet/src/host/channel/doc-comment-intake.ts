/**
 * Doc-comment intake driver: parse → query (bounded retry, cancellable) →
 * admit → the locus controller's existing admission entry
 * (openspec pet-locus-doc-comments D6/D7).
 *
 * The query retry exists because a long-connection event is acknowledged once
 * handled and never redelivered: without it one platform hiccup silently loses
 * the comment. Retries are in-process only and stop when the channel stops; a
 * query that completes after the stop never accepts, replies or reacts.
 *
 * @module
 */

import type { DocCommentQuery, LarkClient } from './lark.js'
import type { LocusControllerResult, NormalizedLocusAdmission } from './locus-controller.js'
import { admitDocCommentEvent, parseDocCommentEvent } from './doc-comment.js'
import type { LocusAdmissionContext } from '../locus/admission.js'

/** Delays before the 2nd and 3rd query attempt (D6). */
export const DOC_COMMENT_QUERY_RETRY_MS = [2_000, 5_000] as const

/** What the driver reports, for Host diagnostics only. */
export type DocCommentIntakeOutcome =
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'handled'; readonly result: LocusControllerResult }

/** Dependencies of {@link createDocCommentIntake}. */
export interface DocCommentIntakeDeps {
  readonly client: Pick<LarkClient, 'queryDocComment'>
  /** Per-event admission context (allowlist, watermark, dedup, authorization). */
  readonly admissionContext: () => LocusAdmissionContext | undefined
  /** The controller's pre-admitted entry; shared with IM after admission. */
  readonly handleAdmission: (admission: NormalizedLocusAdmission) => Promise<LocusControllerResult>
  /** Whether the formal channel is currently running; checked after every await. */
  readonly active: () => boolean
  /** Aborted when the channel stops or is disabled. */
  readonly signal: () => AbortSignal
  /** Injectable delay that rejects on abort. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  readonly onOutcome?: (outcome: DocCommentIntakeOutcome) => void
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    timer.unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Build the `commentIntake` the channel service routes comment lines into.
 * @returns a handler that never throws.
 */
export function createDocCommentIntake(deps: DocCommentIntakeDeps): (line: string) => Promise<void> {
  const report = (outcome: DocCommentIntakeOutcome): void => {
    try {
      deps.onOutcome?.(outcome)
    } catch {
      // Diagnostics never break intake.
    }
  }
  const sleep = deps.sleep ?? defaultSleep

  return async line => {
    const parsed = parseDocCommentEvent(line)
    if (parsed.kind === 'ignored') {
      report({ kind: 'ignored', reason: parsed.reason })
      return
    }
    const { event } = parsed
    const signal = deps.signal()
    const query = deps.client.queryDocComment
    if (query === undefined) {
      report({ kind: 'ignored', reason: 'comment-scope-unknown' })
      return
    }

    let result: DocCommentQuery = { kind: 'error' }
    for (let attempt = 0; attempt <= DOC_COMMENT_QUERY_RETRY_MS.length; attempt += 1) {
      if (attempt > 0) {
        try {
          await sleep(DOC_COMMENT_QUERY_RETRY_MS[attempt - 1]!, signal)
        } catch {
          report({ kind: 'cancelled' })
          return
        }
      }
      if (signal.aborted || !deps.active()) {
        report({ kind: 'cancelled' })
        return
      }
      try {
        result = await query.call(deps.client, event.token, event.commentId, event.replyId)
      } catch {
        result = { kind: 'error' }
      }
      // A late answer after the channel stopped is discarded, success included.
      if (signal.aborted || !deps.active()) {
        report({ kind: 'cancelled' })
        return
      }
      // Only a failed CALL is retried; a definitive scope/reply answer is final.
      if (result.kind !== 'error') break
    }

    const context = deps.admissionContext()
    if (context === undefined) {
      report({ kind: 'ignored', reason: 'admission-unavailable' })
      return
    }
    const admission = admitDocCommentEvent(event, result, context)
    if (admission.kind === 'rejected') {
      report({ kind: 'ignored', reason: admission.reason })
      return
    }
    report({ kind: 'handled', result: await deps.handleAdmission(admission) })
  }
}
