/**
 * A link that points into a topic returns the whole topic: the port wiring of
 * `locus/topic-reader.ts` (change `locus-read-referenced-chats`, D6;
 * R13, R15, R17 list row, R19 stop-reading). The reader's own contract is pinned
 * in `locus-topic-reader.test.ts`; here: one platform page per CLI call, the
 * snapshot carrying the reader state, per-item media, fallbacks and the ledger.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { LocusLinkedPageInput, LocusPageResult } from '../src/host/channel/media.js'
import { FIXTURE_CHAT, FIXTURE_IDS, mgetEnvelope, rawApiEnvelope } from './fixtures/lark-message-envelopes.js'
import { FIXTURE_LINK, linkQueryEnvelope, snapshotMessage } from './fixtures/lark-message-link-envelopes.js'
import { STDERR_FAILURES } from './fixtures/lark-merge-forward-nested-envelopes.js'
import {
  FAILURE_CODES,
  TOPIC_CHAT,
  TOPIC_THREAD,
  TOPIC_TOKENS,
  failureEnvelopeText,
  topicItem,
  topicItems,
  topicMessageId,
  topicPageEnvelope,
} from './fixtures/lark-thread-list-envelopes.js'
import {
  blockText,
  dataBlocks,
  imageIds,
  imagesOf,
  pageText,
  pagedHarness,
  type PagedHarness,
  type Reply,
} from './locus-media-harness.js'

const SOURCE_ID = FIXTURE_IDS.text
const LINKED = topicMessageId(3)

const harnesses: PagedHarness[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})

const linkedRaw = rawApiEnvelope({ messageId: LINKED, msgType: 'text', chatId: TOPIC_CHAT, threadId: TOPIC_THREAD, content: JSON.stringify({ text: '链接所指' }) })
const linkedMget = mgetEnvelope({ messageId: LINKED, msgType: 'text', chatId: TOPIC_CHAT, content: '链接所指', threadId: TOPIC_THREAD })

async function harness(options: {
  readonly topic: (token: string | undefined, args: readonly string[]) => Reply
  readonly raw?: Record<string, Reply>
  readonly store?: Parameters<typeof pagedHarness>[0]['store']
}) {
  const h = await pagedHarness({
    script: {
      raw: {
        [SOURCE_ID]: rawApiEnvelope({ messageId: SOURCE_ID, msgType: 'text', content: JSON.stringify({ text: `看 ${FIXTURE_LINK}` }) }),
        [LINKED]: linkedRaw,
        ...options.raw,
      },
      mget: { [LINKED]: linkedMget },
      query: () => linkQueryEnvelope({ chatId: TOPIC_CHAT, messages: [snapshotMessage({ messageId: LINKED, chatId: TOPIC_CHAT })] }),
      topic: args => options.topic(args.includes('--page-token') ? args[args.indexOf('--page-token') + 1] : undefined, args),
    },
    messageId: SOURCE_ID,
    ...(options.store === undefined ? {} : { store: options.store }),
  })
  harnesses.push(h)
  const link = (request: Partial<LocusLinkedPageInput> = {}): Promise<LocusPageResult> => h.port.readLinkedPage({
    messageId: SOURCE_ID, chatId: FIXTURE_CHAT, caller: 'caller-1', signal: new AbortController().signal, canViewImages: async () => true, ...request,
  })
  const linkAll = async (): Promise<LocusPageResult[]> => {
    const pages: LocusPageResult[] = []
    let cursor: string | undefined
    do {
      const page = await link(cursor === undefined ? {} : { cursor })
      pages.push(page)
      cursor = page.kind === 'ok' ? page.cursor : undefined
    } while (cursor !== undefined && pages.length < 100)
    return pages
  }
  const topicCalls = () => h.calls.filter(call => call.kind === 'topic')
  return Object.assign(h, { link, linkAll, topicCalls })
}

const ok = (page: LocusPageResult) => {
  if (page.kind !== 'ok') throw new Error(`expected ok, got ${page.reason}`)
  return page
}
const headsOf = (pages: readonly LocusPageResult[]) =>
  pages.flatMap(page => (page.kind === 'ok' ? dataBlocks(page.parts) : [])).filter(block => typeof block['unit'] === 'string' && String(block['unit']).endsWith('#h'))
const failedIds = (pages: readonly LocusPageResult[]): string[] =>
  pages.flatMap(page => (page.kind === 'ok' ? page.failed.map(item => item.id) : []))

describe('topic read through the linked tool', () => {
  it('returns root and 5 replies and marks the linked third reply', async () => {
    const h = await harness({ topic: () => topicPageEnvelope(topicItems(0, 5)) })
    const pages = (await h.linkAll()).map(ok)
    const heads = headsOf(pages)
    expect(heads.map(head => head['messageId'])).toEqual([0, 1, 2, 3, 4, 5].map(topicMessageId))
    expect(heads.filter(head => head['linked'] === 'true').map(head => head['messageId'])).toEqual([LINKED])
    expect(pages.at(-1)?.complete).toBe(true)
    expect(h.topicCalls()).toHaveLength(1)
    // Reads are scoped to the source chat's thread, one platform page per call.
    expect(h.topicCalls()[0]!.args.join(' ')).toContain(`--thread ${TOPIC_THREAD}`)
  })

  it('120 messages over three platform pages read in order with no gap or duplicate', async () => {
    const h = await harness({
      topic: token => token === undefined
        ? topicPageEnvelope(topicItems(0, 49), { hasMore: true, pageToken: TOPIC_TOKENS.second })
        : token === TOPIC_TOKENS.second
          ? topicPageEnvelope(topicItems(50, 99), { hasMore: true, pageToken: TOPIC_TOKENS.third })
          : topicPageEnvelope(topicItems(100, 119)),
    })
    const pages = (await h.linkAll()).map(ok)
    const ids = headsOf(pages).map(head => head['messageId'])
    expect(ids).toEqual(Array.from({ length: 120 }, (_, index) => topicMessageId(index)))
    expect(pages.at(-1)?.complete).toBe(true)
    // Continuations never re-read a platform page already read.
    expect(h.topicCalls()).toHaveLength(3)
  })

  it('messages added before the last page are read; the read ends at has_more false', async () => {
    const h = await harness({
      topic: token => token === undefined
        ? topicPageEnvelope(topicItems(0, 4), { hasMore: true, pageToken: TOPIC_TOKENS.second })
        // Three replies appeared while the first page was being read.
        : topicPageEnvelope(topicItems(5, 10)),
    })
    const pages = (await h.linkAll()).map(ok)
    expect(headsOf(pages)).toHaveLength(11)
    expect(h.topicCalls()).toHaveLength(2)
    expect(pages.at(-1)?.cursor).toBeUndefined()
  })

  it('reply with 20 images (limit 8) reads 8, 8, 4 and the next reply follows once', async () => {
    const keys = Array.from({ length: 20 }, (_, index) => `img_t_${String(index).padStart(4, '0')}`)
    const paragraphs = keys.map(key => [{ tag: 'img', image_key: key }])
    const imageReply = topicMessageId(1)
    const h = await harness({
      store: { maxImagesPerMessage: 8 },
      raw: {
        [imageReply]: rawApiEnvelope({
          messageId: imageReply, msgType: 'post', chatId: TOPIC_CHAT, threadId: TOPIC_THREAD,
          content: JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs }),
        }),
      },
      topic: () => topicPageEnvelope([
        topicItem({ index: 0 }),
        topicItem({ index: 1, msgType: 'post', content: keys.map(key => `![Image](${key})`).join('\n') }),
        topicItem({ index: 2, content: '图片之后的回复' }),
      ]),
    })
    const pages = (await h.linkAll()).map(ok)
    expect(pages.map(page => imagesOf(page.parts).length).filter(count => count > 0)).toEqual([8, 8, 4])
    expect(imageIds(pages.flatMap(page => [...page.parts]))).toHaveLength(20)
    expect(blockText(pages.flatMap(page => [...page.parts])).match(/图片之后的回复/g)).toHaveLength(1)
    // Each image downloads with the reply's OWN id.
    expect((await h.cli.calls()).every(call => call.messageId === imageReply)).toBe(true)
    expect(pages.at(-1)?.complete).toBe(true)
  })
})

describe('topic list failures', () => {
  it('first list page transient failure: topic-list diagnostic only, failed empty, attempt 1 cursor, no items delivered', async () => {
    let calls = 0
    const h = await harness({ topic: () => (calls++ === 0 ? { fail: {} } : topicPageEnvelope(topicItems(0, 5))) })
    const first = ok(await h.link())
    expect(first.failed).toEqual([])
    expect(first.cursor).toBeDefined()
    expect(first.delivered).toBe(0)
    expect(pageText(first)).toMatch(/尝试 1/)
    expect(headsOf([first])).toEqual([])
    const second = ok(await h.link({ cursor: first.cursor! }))
    expect(headsOf([second])).toHaveLength(6)
    expect(second.complete).toBe(true)
  })

  it('first list page 230002 falls back to the linked single message with topic-list and no topic cursor', async () => {
    const h = await harness({ topic: () => ({ fail: { stderr: failureEnvelopeText(FAILURE_CODES.noPermission) } }) })
    const pages = (await h.linkAll()).map(ok)
    expect(failedIds(pages)).toEqual(['topic-list'])
    expect(headsOf(pages).map(head => head['messageId'])).toEqual([LINKED])
    expect(blockText(pages.flatMap(page => [...page.parts]))).toContain('链接所指')
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(pages.at(-1)?.complete).toBe(false)
    expect(h.topicCalls()).toHaveLength(1)
  })

  it('page 2 permission failure keeps page 1 and ends terminally with topic-page@2', async () => {
    const h = await harness({
      topic: token => (token === undefined
        ? topicPageEnvelope(topicItems(0, 5), { hasMore: true, pageToken: TOPIC_TOKENS.second })
        : { fail: { stderr: STDERR_FAILURES.noPermission } }),
    })
    const pages = (await h.linkAll()).map(ok)
    expect(headsOf(pages)).toHaveLength(6)
    expect(failedIds(pages)).toEqual(['topic-page@2'])
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(pages.at(-1)?.complete).toBe(false)
  })

  it('topic first page delivered, second page three transient failures: no cursor, topic-page@2 in failed, complete false, delivered kept', async () => {
    const long = (index: number) => topicItem({ index, content: `长回复 ${String(index)} ${'字'.repeat(900)}` })
    const h = await harness({
      topic: token => (token === undefined
        ? topicPageEnvelope([topicItem({ index: 0 }), ...Array.from({ length: 30 }, (_, index) => long(index + 1))], { hasMore: true, pageToken: TOPIC_TOKENS.second })
        : { fail: {} }),
    })
    const pages = (await h.linkAll()).map(ok)
    expect(pages.length).toBeGreaterThan(3)
    expect(headsOf(pages)).toHaveLength(31)
    expect(failedIds(pages)).toEqual(['topic-page@2'])
    // The two earlier transient failures only wrote diagnostics.
    expect(pages.filter(page => /尝试 \d\/3/.test(pageText(page))).length).toBeGreaterThanOrEqual(2)
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(pages.at(-1)?.complete).toBe(false)
    expect(h.topicCalls()).toHaveLength(4)
  })
})
