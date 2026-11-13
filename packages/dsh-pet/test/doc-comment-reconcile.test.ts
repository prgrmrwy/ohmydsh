/**
 * Doc-comment reconciliation fallback (openspec pet-locus-doc-comments):
 * a comment whose live event never arrived is re-admitted from the comment API.
 */

import { describe, expect, it } from 'vitest'
import {
  createDocCommentReconciler,
  DOC_RECONCILE,
  type DocReconcileDeps,
  type DocReconcileOutcome,
} from '../src/host/channel/doc-comment-reconcile.js'
import type { DocCommentsPage, DocCommentCard, DocEventSubscription } from '../src/host/channel/lark.js'
import type {
  LocusControllerResult,
  NormalizedLocusAdmission,
} from '../src/host/channel/locus-controller.js'
import type { LocusAdmissionContext } from '../src/host/locus/admission.js'
import { DOC_IDS } from './fixtures/lark-subscribe.js'

const ROOT = `doc:docx:${DOC_IDS.docToken}`
const OTHER_ROOT = `doc:docx:${DOC_IDS.otherDocToken}`
const BOT = DOC_IDS.botOpenId
const REVIEWER = DOC_IDS.otherUserOpenId
const ACCEPTED: LocusControllerResult = { kind: 'accepted', deliveryId: 'delivery-1', executionId: 'exec-1', locusId: 'locus-1' }

function reply(overrides: Partial<DocCommentCard['replies'][number]> = {}): DocCommentCard['replies'][number] {
  return {
    replyId: '7001',
    text: '@someone 请处理本轮复审',
    authorOpenId: REVIEWER,
    createdAt: 2_000,
    mentionOpenIds: [BOT],
    ...overrides,
  }
}

function card(overrides: Partial<DocCommentCard> = {}): DocCommentCard {
  return {
    commentId: '6001',
    isWhole: false,
    quote: '评审修订',
    replies: [reply()],
    ...overrides,
  }
}

function context(overrides: Partial<LocusAdmissionContext> = {}): LocusAdmissionContext {
  return {
    botOpenId: BOT,
    allowOpenIds: [DOC_IDS.ownerOpenId],
    // Deliberately far in the future: the live subscription watermark must not
    // reject a comment this catch-up exists to recover.
    watermark: 9_999_999,
    isDuplicate: () => false,
    authorizationState: 'authorized',
    ...overrides,
  }
}

function harness(options: {
  readonly pages?: DocCommentsPage[]
  readonly entries?: readonly string[]
  readonly ctx?: LocusAdmissionContext
  readonly handledThrough?: number
  readonly now?: number | (() => number)
  readonly active?: boolean
  readonly aborted?: boolean
  readonly reject?: boolean
  /** Defaults to a successful subscription; `absent` omits the client method. */
  readonly subscribe?: DocEventSubscription | 'throw' | 'absent'
  readonly laterSubscriptions?: readonly DocEventSubscription[]
} = {}) {
  const pages = [...(options.pages ?? [{ comments: [card()], hasMore: false }])]
  const calls: { token: string; pageToken?: string }[] = []
  const admissions: NormalizedLocusAdmission[] = []
  const outcomes: DocReconcileOutcome[] = []
  const subscribeCalls: string[] = []
  const order: string[] = []
  const later = [...(options.laterSubscriptions ?? [])]
  const controller = new AbortController()
  if (options.aborted === true) controller.abort()
  const deps: DocReconcileDeps = {
    client: {
      ...(options.subscribe === 'absent'
        ? {}
        : {
            subscribeDocEvents: async (token: string) => {
              subscribeCalls.push(token)
              order.push('subscribe')
              if (options.subscribe === 'throw') throw new Error('boom')
              return later.shift() ?? (options.subscribe ?? 'success')
            },
          }),
      listDocComments: async (token, pageToken) => {
        calls.push({ token, ...(pageToken === undefined ? {} : { pageToken }) })
        order.push('list')
        return pages.shift()
      },
    },
    entries: () => options.entries ?? [ROOT],
    handledThrough: () => options.handledThrough,
    admissionContext: () => options.ctx ?? context(),
    handleAdmission: async admission => {
      admissions.push(admission)
      return options.reject === true ? { kind: 'refused', reason: 'retired-endpoint' } : ACCEPTED
    },
    active: () => options.active ?? true,
    signal: () => controller.signal,
    onOutcome: outcome => outcomes.push(outcome),
    now: typeof options.now === 'function' ? options.now : () => options.now ?? 100_000,
  }
  return { reconciler: createDocCommentReconciler(deps), admissions, outcomes, calls, subscribeCalls, order, controller }
}

describe('doc-comment reconciliation', () => {
  it('re-admits a comment whose live event never arrived, on the same path as a live event', async () => {
    const h = harness({ handledThrough: 1_500 })

    await h.reconciler.tick()

    expect(h.calls).toEqual([{ token: DOC_IDS.docToken }])
    expect(h.admissions).toHaveLength(1)
    const admission = h.admissions[0]!
    expect(admission.kind).toBe('accepted')
    if (admission.kind !== 'accepted') return
    expect(admission.message.source).toBe('doc-comment')
    expect(admission.message.endpoint).toEqual({ chatId: ROOT, threadId: '6001' })
    expect(admission.message.messageId).toBe(`${ROOT}/6001/7001`)
    expect(admission.message.addressing?.selfMentioned).toBe(true)
    expect(h.outcomes).toContainEqual({ kind: 'admitted', documents: 1, comments: 1 })
  })

  it('starts after the last Delivery the document handled, so history is not re-answered', async () => {
    const h = harness({ handledThrough: 3_000 })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(0)
  })

  it('uses the startup lookback when the document has never handled a Delivery', async () => {
    const now = 3_000_000
    const h = harness({
      now,
      pages: [{ comments: [card({ replies: [reply({ createdAt: 2_500_000 })] })], hasMore: false }],
    })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(1)

    const old = harness({
      now,
      pages: [{ comments: [card({ replies: [reply({ createdAt: 2_000_000 })] })], hasMore: false }],
    })
    await old.reconciler.tick()
    expect(old.admissions).toHaveLength(0)
  })

  it('ignores replies that do not mention the bot and the bot\'s own replies', async () => {
    const h = harness({
      pages: [{
        comments: [
          card({ commentId: '6001', replies: [reply({ replyId: '7001', mentionOpenIds: [DOC_IDS.ownerOpenId] })] }),
          card({ commentId: '6002', replies: [reply({ replyId: '7002', authorOpenId: BOT, mentionOpenIds: [BOT] })] }),
        ],
        hasMore: false,
      }],
    })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(0)
  })

  it('does not re-admit the same reply on the next pass', async () => {
    const h = harness({ handledThrough: 1_500 })
    await h.reconciler.tick()
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(1)
  })

  it('pages a document but stops at the page cap', async () => {
    const h = harness({
      pages: [
        { comments: [card({ commentId: '6001', replies: [reply({ replyId: '7001' })] })], hasMore: true, pageToken: 'p2' },
        { comments: [card({ commentId: '6002', replies: [reply({ replyId: '7002' })] })], hasMore: true, pageToken: 'p3' },
        { comments: [card({ commentId: '6003', replies: [reply({ replyId: '7003' })] })], hasMore: false },
      ],
    })
    await h.reconciler.tick()
    expect(h.calls.map(call => call.pageToken)).toEqual([undefined, 'p2'])
    expect(h.admissions).toHaveLength(2)
  })

  it('reports a failed read as a diagnostic and admits nothing', async () => {
    const h = harness({ pages: [] })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(0)
    expect(h.outcomes).toContainEqual({ kind: 'list-failed', documents: 1 })
  })

  it('does not call the controller for a rejected admission', async () => {
    const h = harness({ handledThrough: 1_500, ctx: context({ authorizationState: 'retired' }) })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(0)
    expect(h.outcomes).toContainEqual({ kind: 'refused', documents: 1, comments: 1 })
  })

  it('round-robins bounded document work across passes', async () => {
    const entries = [ROOT, OTHER_ROOT, 'doc:docx:Dx3', 'doc:docx:Dx4']
    const h = harness({
      entries,
      pages: Array.from({ length: 8 }, () => ({ comments: [] as DocCommentCard[], hasMore: false })),
    })
    await h.reconciler.tick()
    expect(h.calls.map(call => call.token)).toEqual([DOC_IDS.docToken, DOC_IDS.otherDocToken, 'Dx3'])
    await h.reconciler.tick()
    expect(h.calls.map(call => call.token).slice(3)).toEqual(['Dx4', DOC_IDS.docToken, DOC_IDS.otherDocToken])
  })

  it('stops scanning when the channel is inactive or aborted', async () => {
    const inactive = harness({ active: false })
    await inactive.reconciler.tick()
    expect(inactive.calls).toHaveLength(0)

    const aborted = harness({ aborted: true })
    await aborted.reconciler.tick()
    expect(aborted.calls).toHaveLength(0)
  })

  it('subscribes the document once on the first pass, before reading its comments', async () => {
    const h = harness({ handledThrough: 1_500 })

    await h.reconciler.tick()
    await h.reconciler.tick()

    expect(h.subscribeCalls).toEqual([DOC_IDS.docToken])
    expect(h.order.slice(0, 2)).toEqual(['subscribe', 'list'])
    expect(h.outcomes).toContainEqual({ kind: 'subscribed', documents: 1 })
  })

  it('keeps scanning when the subscription is refused, and retries only after the cooldown', async () => {
    let clock = 1_000
    const h = harness({ handledThrough: 1_500, now: () => clock, subscribe: 'missing-scope' })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(1)
    expect(h.outcomes).toContainEqual({ kind: 'subscribe-failed', documents: 1, reason: 'missing-scope' })

    clock += DOC_RECONCILE.subscribeRetryMs - 1
    await h.reconciler.tick()
    expect(h.subscribeCalls).toHaveLength(1)

    clock += 1
    await h.reconciler.tick()
    expect(h.subscribeCalls).toHaveLength(2)
  })

  it('reports a throwing subscription as unknown without blocking the scan', async () => {
    const h = harness({ handledThrough: 1_500, subscribe: 'throw' })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(1)
    expect(h.outcomes).toContainEqual({ kind: 'subscribe-failed', documents: 1, reason: 'unknown' })
  })

  it('works without a subscribe implementation (older adapter)', async () => {
    const h = harness({ handledThrough: 1_500, subscribe: 'absent' })
    await h.reconciler.tick()
    expect(h.admissions).toHaveLength(1)
    expect(h.outcomes.some(outcome => outcome.kind === 'subscribed' || outcome.kind === 'subscribe-failed')).toBe(false)
  })

  it('start schedules the first pass after the startup delay and stop cancels it', () => {
    const scheduled: { run: () => void; delayMs: number }[] = []
    const cancelled: string[] = []
    const reconciler = createDocCommentReconciler({
      client: { listDocComments: async () => ({ comments: [], hasMore: false }) },
      entries: () => [ROOT],
      handledThrough: () => undefined,
      admissionContext: () => context(),
      handleAdmission: async () => ACCEPTED,
      active: () => true,
      signal: () => new AbortController().signal,
      schedule: (run, delayMs) => {
        scheduled.push({ run, delayMs })
        return { cancel: () => cancelled.push('cancelled') }
      },
    })

    reconciler.start()
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.delayMs).toBe(DOC_RECONCILE.startupDelayMs)
    reconciler.stop()
    expect(cancelled).toHaveLength(1)
  })
})
