/**
 * Units, segments, page packing and the ledger
 * (change `locus-read-referenced-chats`, tasks 5.x; R2, R16 a, R17–R21).
 *
 * Real child processes download (path-mode fake CLI) so cleanup and process
 * handling are exercised; platform reads are scripted in the real CLI shape.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createLocusMediaPort, segmentText, type LocusPageResult } from '../src/host/channel/media.js'
import { createCursorStore } from '../src/host/locus/media-cursor.js'
import { FIXTURE_CHAT, FIXTURE_IDS } from './fixtures/lark-message-envelopes.js'
import { NESTED_IDS } from './fixtures/lark-merge-forward-nested-envelopes.js'
import {
  ROOT_ID,
  blockText,
  dataBlocks,
  imageIds,
  imageKey,
  imagesOf,
  mergeOfImages,
  pageChars,
  pageText,
  pagedHarness,
  postWithImages,
  textMessage,
  type PagedHarness,
} from './locus-media-harness.js'
import { mgetEnvelope, rawApiEnvelope } from './fixtures/lark-message-envelopes.js'

const POST_ID = FIXTURE_IDS.text
const harnesses: PagedHarness[] = []
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map(h => h.dispose()))
})
async function harness(options: Parameters<typeof pagedHarness>[0]): Promise<PagedHarness> {
  const h = await pagedHarness(options)
  harnesses.push(h)
  return h
}

const ok = (page: LocusPageResult) => {
  if (page.kind !== 'ok') throw new Error(`expected ok, got ${page.reason}`)
  return page
}
const failedIds = (pages: readonly LocusPageResult[]): string[] =>
  pages.flatMap(page => (page.kind === 'ok' ? page.failed.map(item => item.id) : []))

function postHarness(count: number, keyOf?: (index: number) => string, store?: Parameters<typeof pagedHarness>[0]['store'], port?: Parameters<typeof pagedHarness>[0]['port']) {
  const post = postWithImages(POST_ID, count, keyOf)
  return harness({
    script: { raw: { [POST_ID]: post.raw }, mget: { [POST_ID]: post.mget } },
    messageId: POST_ID,
    ...(store === undefined ? {} : { store }),
    ...(port === undefined ? {} : { port }),
  })
}

describe('model without image input', () => {
  it('text model: 3 images and 1 video collapse into one metadata line, nothing downloaded, complete unaffected', async () => {
    const paragraphs = [
      [{ tag: 'text', text: '正文', style: [] }],
      ...[1, 2, 3].map(index => [{ tag: 'img', image_key: imageKey(index) }]),
      [{ tag: 'media', file_key: 'file_v3_vid_0001', image_key: 'img_cover_0001' }],
    ]
    const h = await harness({
      script: {
        raw: { [POST_ID]: rawApiEnvelope({ messageId: POST_ID, msgType: 'post', content: JSON.stringify({ title: '', content: paragraphs, content_v2: paragraphs }) }) },
        mget: { [POST_ID]: mgetEnvelope({ messageId: POST_ID, msgType: 'post', content: '正文' }) },
      },
      messageId: POST_ID,
    })
    const page = ok(await h.read({ canViewImages: async () => false }))
    expect(await h.cli.calls()).toEqual([])
    expect(h.saved.saveImages).not.toHaveBeenCalled()
    const lines = page.parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).filter(text => text.includes('未下载任何媒体'))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('3 张图片')
    expect(lines[0]).toContain('1 段视频')
    expect(page.failed).toEqual([])
    expect(page.complete).toBe(true)
    expect(page.cursor).toBeUndefined()
  })
})

describe('image quota paging', () => {
  it('20 images with limit 8 continue as 8, 8, 4 without an omitted note', async () => {
    const h = await postHarness(20, undefined, { maxImagesPerMessage: 8 })
    const pages = (await h.readAll()).map(ok)
    expect(pages.map(page => imagesOf(page.parts).length)).toEqual([8, 8, 4])
    expect(pages.map(page => page.cursor !== undefined)).toEqual([true, true, false])
    expect(pages.map(page => pageText(page)).join('\n')).not.toMatch(/省略|未读取：超出/)
    expect(pages.at(-1)?.complete).toBe(true)
    expect(imageIds(pages.flatMap(page => [...page.parts]))).toHaveLength(20)
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('40 images with limit 8 continue over 5 pages and the last has no cursor', async () => {
    const merge = mergeOfImages(ROOT_ID, Array.from({ length: 40 }, (_, index) => imageKey(index)))
    const h = await harness({
      script: { raw: { [ROOT_ID]: merge.raw }, mget: { [ROOT_ID]: merge.mget } },
      store: { maxImagesPerMessage: 8 },
    })
    const pages = (await h.readAll()).map(ok)
    expect(pages.map(page => imagesOf(page.parts).length)).toEqual([8, 8, 8, 8, 8])
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(pages.slice(0, -1).every(page => page.cursor !== undefined)).toBe(true)
  })

  it('merge continuation after the first page makes zero raw and mget calls', async () => {
    const merge = mergeOfImages(ROOT_ID, Array.from({ length: 20 }, (_, index) => imageKey(index)))
    const h = await harness({
      script: { raw: { [ROOT_ID]: merge.raw }, mget: { [ROOT_ID]: merge.mget } },
      store: { maxImagesPerMessage: 8 },
    })
    const first = ok(await h.read())
    expect(first.cursor).toBeDefined()
    const before = h.calls.length
    const rest = await h.readAll({ cursor: first.cursor! })
    expect(rest.length).toBe(2)
    expect(h.calls.length).toBe(before)
    expect(h.calls.filter(call => call.kind === 'raw' || call.kind === 'mget')).toHaveLength(2)
  })

  it('unknown and foreign cursors fail before any platform call', async () => {
    const h = await postHarness(20, undefined, { maxImagesPerMessage: 8 })
    const first = ok(await h.read())
    const calls = h.calls.length
    expect(await h.read({ cursor: 'never-issued' })).toMatchObject({ kind: 'failed', reason: 'cursor-invalid' })
    expect(await h.read({ cursor: first.cursor!, caller: 'someone-else' })).toMatchObject({ kind: 'failed', reason: 'cursor-mismatch' })
    expect(await h.read({ cursor: first.cursor!, messageId: NESTED_IDS.G })).toMatchObject({ kind: 'failed', reason: 'cursor-mismatch' })
    expect(h.calls.length).toBe(calls)
  })
})

describe('advance rule and ledger', () => {
  it('one transient failure then success: attempt-1 cursor, no failed entry, complete on the last page', async () => {
    const h = await postHarness(5, index => (index === 2 ? 'img_flaky1_0002' : imageKey(index)))
    const first = ok(await h.read())
    expect(imagesOf(first.parts)).toHaveLength(2)
    expect(first.cursor).toBeDefined()
    expect(first.failed).toEqual([])
    expect(first.complete).toBe(false)
    expect(pageText(first)).toMatch(/尝试 1/)
    const second = ok(await h.read({ cursor: first.cursor! }))
    expect(imagesOf(second.parts)).toHaveLength(3)
    expect(second.cursor).toBeUndefined()
    expect(second.failed).toEqual([])
    expect(second.complete).toBe(true)
  })

  it('third transient failure records the unit as failed, later units delivered, complete false', async () => {
    const h = await postHarness(5, index => (index === 2 ? 'img_flaky9_0002' : imageKey(index)))
    const first = ok(await h.read())
    const second = ok(await h.read({ cursor: first.cursor! }))
    expect([first.failed, second.failed]).toEqual([[], []])
    expect(pageText(second)).toMatch(/尝试 2/)
    const third = ok(await h.read({ cursor: second.cursor! }))
    expect(third.failed).toHaveLength(1)
    expect(third.failed[0]!.id).toBe(`${POST_ID}#r2`)
    expect(third.failed[0]!.reason).toMatch(/^transient\(/)
    expect(imagesOf(third.parts)).toHaveLength(2)
    expect(third.cursor).toBeUndefined()
    expect(third.complete).toBe(false)
  })

  it('transient failure after earlier deliveries keeps the cursor on the failing unit with attempt 1', async () => {
    const cursors = createCursorStore()
    const h = await postHarness(6, index => (index === 3 ? 'img_flaky1_0003' : imageKey(index)), undefined, { cursors })
    const page = ok(await h.read())
    expect(imagesOf(page.parts)).toHaveLength(3)
    expect(page.failed).toEqual([])
    expect(page.complete).toBe(false)
    const resolved = cursors.resolve(page.cursor!, { caller: 'caller-1', messageId: POST_ID })
    if (resolved.kind !== 'ok') throw new Error('cursor must resolve')
    // Units: head(0), one text segment(1), images from 2; the failing image is unit 5.
    expect([resolved.snapshot.position, resolved.snapshot.attempt]).toEqual([5, 1])
  })

  it('final 234003 failure is recorded and the same page continues', async () => {
    const h = await postHarness(4, index => (index === 1 ? 'img_x_234003' : imageKey(index)))
    const page = ok(await h.read())
    expect(page.failed).toEqual([{ id: `${POST_ID}#r1`, reason: 'resource-download-failed' }])
    expect(imagesOf(page.parts)).toHaveLength(3)
    expect(page.cursor).toBeUndefined()
    expect(page.complete).toBe(false)
  })

  it('no failures yields complete true on the last page with no cursor', async () => {
    const h = await postHarness(3)
    const page = ok(await h.read())
    expect([page.complete, page.cursor, page.failed]).toEqual([true, undefined, []])
    expect(page.delivered).toBeGreaterThanOrEqual(5)
  })

  it('an image skipped on page 1, reading ends on page 2: failed id only on page 1 and in cross-page aggregation; last page complete false, no cursor, does not repeat the id', async () => {
    const h = await postHarness(20, index => (index === 2 ? 'img_y_234003' : imageKey(index)), { maxImagesPerMessage: 8 })
    const pages = (await h.readAll()).map(ok)
    expect(failedIds(pages)).toEqual([`${POST_ID}#r2`])
    expect(pages[0]!.failed).toHaveLength(1)
    expect(pages.slice(1).every(page => page.failed.length === 0)).toBe(true)
    expect(pages.at(-1)?.complete).toBe(false)
    expect(pages.at(-1)?.cursor).toBeUndefined()
    expect(imageIds(pages.flatMap(page => [...page.parts]))).toHaveLength(19)
  })

  it('first-call container transient failure: complete false, no cursor; repeating the call starts clean', async () => {
    const text = textMessage(POST_ID, '你好')
    let attempts = 0
    const h = await harness({
      script: {
        raw: { [POST_ID]: () => (attempts++ === 0 ? { fail: {} } : text.raw) },
        mget: { [POST_ID]: text.mget },
      },
      messageId: POST_ID,
    })
    const first = ok(await h.read())
    expect(first.complete).toBe(false)
    expect(first.cursor).toBeUndefined()
    expect(first.delivered).toBe(0)
    expect(first.failed).toHaveLength(1)
    expect(first.failed[0]!.id).toBe(`container@${POST_ID}`)
    expect(pageText(first)).toMatch(/原样重发/)
    const second = ok(await h.read())
    expect(second.complete).toBe(true)
    expect(blockText(second.parts)).toContain('你好')
  })

  it('injected failure sequences: (position, attempt) strictly increases, attempt ≤ 2, reads terminate', async () => {
    const flavours = ['ok', '234003', 'flaky1', 'flaky2', 'flaky9']
    for (const seed of [7, 31]) {
      let state = seed
      const pick = (): string => {
        state = (state * 48271) % 2147483647
        return flavours[state % flavours.length]!
      }
      const cursors = createCursorStore()
      const count = 10
      const h = await postHarness(count, index => `img_${pick()}_${String(index).padStart(4, '0')}`, { maxImagesPerMessage: 3 }, { cursors })
      let previous: readonly [number, number, number] = [-1, -1, -1]
      let cursor: string | undefined
      let pages = 0
      let issued = 0
      do {
        const page = ok(await h.read(cursor === undefined ? {} : { cursor }))
        pages += 1
        cursor = page.cursor
        if (cursor !== undefined) {
          const resolved = cursors.resolve(cursor, { caller: 'caller-1', messageId: POST_ID })
          if (resolved.kind !== 'ok') throw new Error('issued cursor must resolve')
          const now: readonly [number, number, number] = [resolved.snapshot.position, resolved.snapshot.progress ?? 0, resolved.snapshot.attempt]
          expect(resolved.snapshot.attempt).toBeLessThanOrEqual(2)
          const increased = now[0] > previous[0]
            || (now[0] === previous[0] && (now[1] > previous[1] || (now[1] === previous[1] && now[2] > previous[2])))
          expect(increased).toBe(true)
          previous = now
          issued += 1
        }
      } while (cursor !== undefined && pages < count * 4)
      expect(cursor).toBeUndefined()
      expect(issued).toBeGreaterThan(0)
      await h.dispose()
      harnesses.pop()
    }
  })

  it('replay and concurrent same-cursor calls start at the same unit with identical ids and refs; spools empty', async () => {
    const h = await postHarness(20, undefined, { maxImagesPerMessage: 8 })
    const first = ok(await h.read())
    const [a, b] = await Promise.all([h.read({ cursor: first.cursor! }), h.read({ cursor: first.cursor! })])
    const c = await h.read({ cursor: first.cursor! })
    for (const other of [b, c]) expect(imageIds(ok(other).parts)).toEqual(imageIds(ok(a).parts))
    // Same attachment refs (content-addressed); only the freshly issued cursor in the ledger line differs.
    const refs = (page: LocusPageResult): string => JSON.stringify(imagesOf(ok(page).parts))
    expect(refs(b)).toBe(refs(a))
    expect(refs(c)).toBe(refs(a))
    expect(new Set([a, b, c].map(page => ok(page).cursor)).size).toBe(3)
    expect(h.cli.spoolEntries()).toEqual([])
  })
})

const SEGMENT_BUDGET = 4000
const escapedLength = (text: string): number => JSON.stringify(text).replace(/[<>&]/g, '\\u003c').length - 2

describe('lossless segments and page capacity', () => {
  const textHarness = (text: string, port?: Parameters<typeof pagedHarness>[0]['port']) => {
    const message = textMessage(POST_ID, text)
    return harness({
      script: { raw: { [POST_ID]: message.raw }, mget: { [POST_ID]: message.mget } },
      messageId: POST_ID,
      ...(port === undefined ? {} : { port }),
    })
  }
  const segmentsOf = (pages: readonly LocusPageResult[]) =>
    pages.flatMap(page => (page.kind === 'ok' ? dataBlocks(page.parts) : [])).filter(block => typeof block['text'] === 'string')

  it('5000-char message is returned whole with no truncation marker', async () => {
    const original = '字'.repeat(5000)
    const h = await textHarness(original)
    const pages = (await h.readAll()).map(ok)
    expect(pages.map(page => blockText(page.parts)).join('')).toBe(original)
    expect(pages.map(page => pageText(page)).join('\n')).not.toMatch(/截断/)
  })

  it('16000 "<" characters: every segment within the 4000 escaped budget; boundaries depend only on the text; rejoins', async () => {
    const original = '<'.repeat(16_000)
    const planned = segmentText(original)
    expect(planned.map(segment => segment.text).join('')).toBe(original)
    for (const segment of planned) expect(escapedLength(segment.text)).toBeLessThanOrEqual(SEGMENT_BUDGET)
    expect(planned.length).toBeGreaterThan(20)
    const h = await textHarness(original)
    const blocks = segmentsOf(await h.readAll())
    expect(blocks.map(block => block['text']).join('')).toBe(original)
    expect(blocks.map(block => block['unit'])).toEqual(planned.map(segment => `${POST_ID}#t@${String(segment.offset)}`))
  })

  it('same 20000-char text under different page overheads has identical segment ids and ranges', async () => {
    const original = 'abcdefghij'.repeat(2000)
    const small = await textHarness(original, { page: { capacityChars: 9_000 } })
    const large = await textHarness(original)
    const a = segmentsOf(await small.readAll())
    const b = segmentsOf(await large.readAll())
    expect(a.map(block => [block['unit'], block['text']])).toEqual(b.map(block => [block['unit'], block['text']]))
    // Different overheads, different numbers of segments per page.
    expect((await small.readAll()).length).toBeGreaterThan((await large.readAll()).length)
  })

  it('16000 "<" paginate by final escaped size; every block parses; segments rejoin to the original', async () => {
    const original = '<'.repeat(16_000)
    const h = await textHarness(original)
    const pages = (await h.readAll()).map(ok)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(pageChars(page)).toBeLessThanOrEqual(16_000)
      expect(() => dataBlocks(page.parts)).not.toThrow()
    }
    expect(pages.map(page => blockText(page.parts)).join('')).toBe(original)
    // The platform text never appears as a literal angle bracket outside the Host's own tags.
    const flat = pages.map(page => pageText(page)).join('\n')
    expect(flat.replace(/<\/?(message-body)>/g, '')).not.toMatch(/[<>]/)
  })

  it('capacity below reserve plus one segment throws at construction', async () => {
    const h = await textHarness('x')
    expect(() => createLocusMediaPort({
      attachments: h.saved.store,
      download: { binary: h.cli.binary, version: '1.0.97', spoolRoot: h.cli.spool },
      page: { capacityChars: 1_000 },
    })).toThrow(/capacity/i)
  })

  it('1000 final-failed images: pages within capacity, each failed id exactly once, cursor strictly advances, finite, complete false', async () => {
    // Unparseable image nodes are terminal failures that need no download process.
    const rootNode = { id: ROOT_ID, msgType: 'merge_forward', content: 'Merged and Forwarded Message', chatId: FIXTURE_CHAT }
    const merge = mergeOfImages(ROOT_ID, [])
    const nodes = [rootNode, ...Array.from({ length: 1000 }, (_, index) => ({
      id: `om_x100b00000000000000000000007${String(index).padStart(5, '0')}`,
      msgType: 'image',
      content: 'not json',
      upper: ROOT_ID,
      chatId: FIXTURE_CHAT,
    }))]
    const { rawTreeEnvelope } = await import('./fixtures/lark-merge-forward-nested-envelopes.js')
    const h = await harness({ script: { raw: { [ROOT_ID]: rawTreeEnvelope(nodes) }, mget: { [ROOT_ID]: merge.mget } } })
    const pages = (await h.readAll()).map(ok)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) expect(pageChars(page)).toBeLessThanOrEqual(16_000)
    const ids = failedIds(pages)
    expect(ids).toHaveLength(1000)
    expect(new Set(ids).size).toBe(1000)
    expect(pages.at(-1)?.complete).toBe(false)
    expect(pages.at(-1)?.cursor).toBeUndefined()
  })
})
