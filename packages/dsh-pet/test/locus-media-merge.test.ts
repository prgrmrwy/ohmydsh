/**
 * Merge-forward text and video through the paged port read
 * (change `locus-read-referenced-chats`, tasks 4.x; R1 last row, R8 first row).
 *
 * Replaces the pre-redesign cases that asserted a 30-child cap, node-level mget
 * alignment and metadata-only nesting (test-plan ⚪ rows, task 1.1).
 */

import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { createLocusMediaPort } from '../src/host/channel/media.js'
import { FIXTURE_CHAT, FIXTURE_IDS, MGET_TEXT, rawApiEnvelope } from './fixtures/lark-message-envelopes.js'
import {
  MERGE_KEYS,
  MERGE_OUTER_ID,
  childId,
  mergeBlock,
  mgetMergeEnvelope,
  rawMergeEnvelope,
  textChild,
  videoChild,
} from './fixtures/lark-merge-forward-envelopes.js'
import { blockText, contentStore, dataBlocks, imagesOf, pageText, pathCli, scriptedRunner, type PathCli } from './locus-media-harness.js'

let cli: PathCli | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  cli = undefined
})

async function harness(raw: Record<string, unknown>, mget: Record<string, unknown>, id = MERGE_OUTER_ID) {
  cli = await pathCli()
  const saved = contentStore()
  const script = scriptedRunner({ raw: { [id]: raw }, mget: { [id]: mget } })
  const port = createLocusMediaPort({
    attachments: saved.store,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner: script.runner,
  })
  const read = () => port.readMessagePage({
    messageId: id, chatId: FIXTURE_CHAT, caller: 'caller-1', signal: new AbortController().signal, canViewImages: async () => true,
  })
  return { read, cli, calls: script.calls }
}

describe('merge-forward text and resources', () => {
  it('merge text is the root mget block; child video downloads with the outer id', async () => {
    const children = [textChild(1), videoChild(2), textChild(3)]
    const entries = [
      { body: '夹具子消息 1' },
      { body: `夹具视频说明\n[Media: ${MERGE_KEYS.video}]` },
      { body: '夹具子消息 3' },
    ]
    const h = await harness(rawMergeEnvelope(children), mgetMergeEnvelope(mergeBlock(entries)))
    const result = await h.read()
    if (result.kind !== 'ok') throw new Error(`expected ok, got ${result.reason}`)

    // The text is the root's rendered block, whole: all three children, sender and time included.
    const text = blockText(result.parts)
    for (const expected of ['夹具子消息 1', '夹具视频说明', '夹具子消息 3', '夹具用户', '2026-11-13T17:10:00+08:00']) {
      expect(text).toContain(expected)
    }
    expect(text.indexOf('夹具子消息 1')).toBeLessThan(text.indexOf('夹具子消息 3'))
    // The root is described once, by its own head block.
    expect(dataBlocks(result.parts).filter(block => block['messageId'] === MERGE_OUTER_ID)).toHaveLength(1)
    expect(h.calls.filter(call => call.kind === 'mget')).toHaveLength(1)

    // The child's cover downloads through the OUTER id; with no frame tools the video says so.
    expect((await h.cli.calls())[0]).toEqual({ type: 'image', fileKey: MERGE_KEYS.cover, messageId: MERGE_OUTER_ID })
    expect(imagesOf(result.parts)).toHaveLength(1)
    expect(pageText(result)).toContain('frame-tools-unavailable')
    expect(h.cli.spoolEntries()).toEqual([])
  })

  it('non-merge multi-item response is message-not-unique', async () => {
    const single = rawApiEnvelope({ messageId: FIXTURE_IDS.text, msgType: 'text', content: '{"text":"x"}' })
    const items = (single['data'] as { items: unknown[] }).items
    const doubled = {
      ...single,
      data: { items: [...items, { ...(items[0] as object), message_id: childId(1), upper_message_id: FIXTURE_IDS.text }] },
    }
    const h = await harness(doubled, MGET_TEXT, FIXTURE_IDS.text)
    expect(await h.read()).toMatchObject({ kind: 'failed', reason: 'message-not-unique' })
    expect(await h.cli.calls()).toEqual([])
  })
})
