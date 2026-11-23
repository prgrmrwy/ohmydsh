/**
 * Merge-forward tree: validation before any render or download, pre-order
 * traversal, root-id downloads (change `locus-read-referenced-chats`, tasks 4.x; R8, R9).
 *
 * Fixtures: `fixtures/lark-merge-forward-nested-envelopes.ts` (measured 2026-11-21).
 */

import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocusMediaPort, type LocusPageResult } from '../src/host/channel/media.js'
import { FIXTURE_CHAT, FIXTURE_OTHER_CHAT } from './fixtures/lark-message-envelopes.js'
import {
  NESTED_IDS,
  NESTED_KEYS,
  imageContent,
  nestedFillerId,
  nestedMgetEnvelope,
  nestedMgetText,
  nestedNodes,
  rawTreeEnvelope,
  textContent,
  type NestedNode,
} from './fixtures/lark-merge-forward-nested-envelopes.js'
import { blockText, contentStore, imagesOf, pageText, pathCli, scriptedRunner, type PathCli } from './locus-media-harness.js'

let cli: PathCli | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  cli = undefined
})

async function setup(options: {
  readonly nodes?: readonly NestedNode[]
  readonly mgetText?: string
  readonly root?: string
}) {
  cli = await pathCli()
  const root = options.root ?? NESTED_IDS.F
  const saved = contentStore()
  const script = scriptedRunner({
    raw: { [root]: rawTreeEnvelope(options.nodes ?? nestedNodes()) },
    mget: { [root]: nestedMgetEnvelope(options.mgetText ?? nestedMgetText(), root) },
  })
  const port = createLocusMediaPort({
    attachments: saved.store,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner: script.runner,
  })
  const read = (cursor?: string) => port.readMessagePage({
    messageId: root,
    chatId: FIXTURE_CHAT,
    caller: 'caller-1',
    ...(cursor === undefined ? {} : { cursor }),
    signal: new AbortController().signal,
    canViewImages: async () => true,
  })
  /** Follow every cursor to the end. */
  const readAll = async (): Promise<LocusPageResult[]> => {
    const pages: LocusPageResult[] = []
    let cursor: string | undefined
    do {
      const page = await read(cursor)
      pages.push(page)
      cursor = page.kind === 'ok' ? page.cursor : undefined
    } while (cursor !== undefined && pages.length < 200)
    return pages
  }
  return { read, readAll, cli, calls: script.calls, saved, root }
}

function okPage(page: LocusPageResult) {
  if (page.kind !== 'ok') throw new Error(`expected ok, got ${page.reason}`)
  return page
}

const node = (id: string, msgType: string, content: string, upper: string | undefined, chatId = FIXTURE_OTHER_CHAT): NestedNode =>
  ({ id, msgType, content, ...(upper === undefined ? {} : { upper }), chatId })

const ROOT_NODE: NestedNode = node(NESTED_IDS.F, 'merge_forward', 'Merged and Forwarded Message', undefined, FIXTURE_CHAT)
const idOf = (tag: string): string => `om_x100b0000000000000000000000009${tag}`

describe('nested merge-forward read', () => {
  it('nested F/G/H: one mget block, images from G and H downloaded with the root id', async () => {
    const h = await setup({})
    const page = okPage(await h.read())
    const text = blockText(page.parts)
    // One rendered block carries all three levels.
    for (const expected of ['嵌套夹具文字 F1', '嵌套夹具文字 H1', '嵌套夹具文字 H22', '夹具.pdf']) expect(text).toContain(expected)
    expect(h.calls.filter(call => call.kind === 'mget')).toHaveLength(1)
    // Every level's image downloads with the ROOT id, in pre-order.
    expect(await h.cli.calls()).toEqual([
      { type: 'image', fileKey: NESTED_KEYS.l2, messageId: NESTED_IDS.F },
      { type: 'image', fileKey: NESTED_KEYS.l3a, messageId: NESTED_IDS.F },
      { type: 'image', fileKey: NESTED_KEYS.l3b, messageId: NESTED_IDS.F },
    ])
    expect(imagesOf(page.parts)).toHaveLength(3)
    expect(page.failed).toEqual([])
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('120 children return over pages with no omitted note', async () => {
    const children = Array.from({ length: 120 }, (_, index) =>
      node(idOf(String(index).padStart(3, '0')), 'text', textContent(`子消息 ${String(index + 1)}`), NESTED_IDS.F))
    const mget = ['<forwarded_messages>', ...children.flatMap((_, index) => [`[2026-11-13T17:10:00+08:00] 夹具用户:`, `    子消息 ${String(index + 1)}`]), '</forwarded_messages>'].join('\n')
    const h = await setup({ nodes: [ROOT_NODE, ...children], mgetText: mget })
    const pages = (await h.readAll()).map(okPage)
    const all = pages.map(page => blockText(page.parts)).join('')
    for (const expected of ['子消息 1\n', '子消息 60\n', '子消息 120\n']) expect(all).toContain(expected)
    expect(pages.map(page => pageText(page)).join('\n')).not.toMatch(/省略|未显示|另有 \d+ 条/)
    expect(pages.at(-1)?.complete).toBe(true)
    expect(pages.at(-1)?.cursor).toBeUndefined()
  })

  it('interactive, file and audio nodes are metadata lines, not failures, nothing downloaded', async () => {
    const cards = Array.from({ length: 10 }, (_, index) =>
      node(idOf(`c${String(index).padStart(2, '0')}`), 'interactive', JSON.stringify({ title: '卡片' }), NESTED_IDS.F))
    const file = node(idOf('f00'), 'file', JSON.stringify({ file_key: 'file_v3_x1', file_name: '夹具.pdf' }), NESTED_IDS.F)
    const audio = node(idOf('a00'), 'audio', JSON.stringify({ file_key: 'file_v3_x2', duration: 3000 }), NESTED_IDS.F)
    const h = await setup({ nodes: [ROOT_NODE, ...cards, file, audio], mgetText: '<forwarded_messages>\n</forwarded_messages>' })
    const page = okPage(await h.read())
    const text = pageText(page)
    expect(text.match(/interactive/g)?.length).toBe(10)
    expect(text).toMatch(/file/)
    expect(text).toMatch(/audio/)
    expect(page.failed).toEqual([])
    expect(page.complete).toBe(true)
    expect(await h.cli.calls()).toEqual([])
  })

  it('inner key failing 234003 is a failed item and is not retried with another id', async () => {
    const bad = node(idOf('b01'), 'image', imageContent('img_inner_234003'), NESTED_IDS.F)
    const good = node(idOf('b02'), 'image', imageContent('img_good_0002'), NESTED_IDS.F)
    const h = await setup({ nodes: [ROOT_NODE, bad, good], mgetText: '<forwarded_messages>\n</forwarded_messages>' })
    const page = okPage(await h.read())
    expect(page.failed).toEqual([{ id: `${bad.id}#r0`, reason: 'resource-download-failed' }])
    expect(page.complete).toBe(false)
    expect(imagesOf(page.parts)).toHaveLength(1)
    // One attempt, with the root id; never the child's own id.
    expect(await h.cli.calls()).toEqual([
      { type: 'image', fileKey: 'img_inner_234003', messageId: NESTED_IDS.F },
      { type: 'image', fileKey: 'img_good_0002', messageId: NESTED_IDS.F },
    ])
  })
})

describe('merge-forward tree validation', () => {
  it('out-of-order items traverse in pre-order with sibling order kept', async () => {
    const R = NESTED_IDS.F
    const A = node(idOf('a01'), 'image', imageContent('img_a_01'), R)
    const B = node(idOf('b01'), 'merge_forward', 'Merged and Forwarded Message', R)
    const B1 = node(idOf('b11'), 'image', imageContent('img_b1_02'), B.id)
    const C = node(idOf('c01'), 'image', imageContent('img_c_03'), R)
    // Children before their parent; siblings of R in raw order: C, A, B.
    const h = await setup({ nodes: [ROOT_NODE, B1, C, A, B], mgetText: '<forwarded_messages>\n</forwarded_messages>' })
    okPage(await h.read())
    expect((await h.cli.calls()).map(call => call.fileKey)).toEqual(['img_c_03', 'img_a_01', 'img_b1_02'])
  })

  it('duplicate message_id keeps the first occurrence only', async () => {
    const first = node(idOf('d01'), 'image', imageContent('img_first_01'), NESTED_IDS.F)
    const again = node(idOf('d01'), 'image', imageContent('img_second_02'), NESTED_IDS.F)
    const h = await setup({ nodes: [ROOT_NODE, first, again], mgetText: '<forwarded_messages>\n</forwarded_messages>' })
    const page = okPage(await h.read())
    expect((await h.cli.calls()).map(call => call.fileKey)).toEqual(['img_first_01'])
    expect(imagesOf(page.parts)).toHaveLength(1)
  })

  it('first item not the root, or root chat mismatch, is rejected before any download', async () => {
    const child = node(idOf('e01'), 'image', imageContent('img_e_01'), NESTED_IDS.F)
    const notRoot = await setup({ nodes: [child, ROOT_NODE], mgetText: 'x' })
    expect(await notRoot.read()).toMatchObject({ kind: 'failed', reason: 'envelope-invalid' })
    expect(await notRoot.cli.calls()).toEqual([])
    await rm(notRoot.cli.root, { recursive: true, force: true })

    const foreignRoot = await setup({ nodes: [{ ...ROOT_NODE, chatId: FIXTURE_OTHER_CHAT }, child], mgetText: 'x' })
    expect(await foreignRoot.read()).toMatchObject({ kind: 'failed', reason: 'chat-mismatch' })
    expect(await foreignRoot.cli.calls()).toEqual([])
  })

  it('a cycle is envelope-invalid(cycle) before any download', async () => {
    const R = NESTED_IDS.F
    const loop = node(idOf('f01'), 'text', textContent('环'), R)
    const image = node(idOf('f02'), 'image', imageContent('img_cycle_01'), R)
    // The root names a descendant as its own parent, so a walk from the root meets it twice.
    const h = await setup({ nodes: [{ ...ROOT_NODE, upper: loop.id }, loop, image], mgetText: 'x' })
    expect(await h.read()).toMatchObject({ kind: 'failed', reason: 'envelope-invalid', detail: 'cycle' })
    expect(await h.cli.calls()).toEqual([])
    expect(h.calls.filter(call => call.kind === 'mget')).toHaveLength(0)
  })

  it('unreachable raw item fails the container as envelope-invalid(unreachable) before any render or download', async () => {
    const child = node(idOf('g01'), 'image', imageContent('img_reach_01'), NESTED_IDS.F)
    const orphan = node(idOf('g02'), 'image', imageContent('img_orphan_02'), 'om_missing_parent')
    const h = await setup({ nodes: [ROOT_NODE, child, orphan], mgetText: 'x' })
    expect(await h.read()).toMatchObject({ kind: 'failed', reason: 'envelope-invalid', detail: 'unreachable' })
    expect(await h.cli.calls()).toEqual([])
    expect(h.calls.filter(call => call.kind === 'mget')).toHaveLength(0)
  })

  it('mget text containing orphan X: whole container fails; neither A nor X text nor resources delivered', async () => {
    const A = node(idOf('h01'), 'text', textContent('正文 A'), NESTED_IDS.F)
    const X = node(idOf('h02'), 'text', textContent('正文 X'), undefined)
    const text = '<forwarded_messages>\n[t] 夹具用户:\n    正文 A\n[t] 夹具用户:\n    正文 X\n</forwarded_messages>'
    const h = await setup({ nodes: [ROOT_NODE, A, X], mgetText: text })
    const result = await h.read()
    expect(result).toMatchObject({ kind: 'failed', reason: 'envelope-invalid', detail: 'unreachable' })
    expect(JSON.stringify(result)).not.toContain('正文')
    expect(await h.cli.calls()).toEqual([])
  })
})

// Referenced so an unused-import lint cannot hide a fixture drift.
void nestedFillerId
