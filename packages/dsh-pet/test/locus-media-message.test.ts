/**
 * Port-level single-message read (`createLocusMediaPort(...).readMessage`).
 *
 * The platform reads go through an injected runner that answers with the
 * REDACTED REAL envelopes in `fixtures/lark-message-envelopes.ts`; downloads go
 * through a real fake-CLI process into a real spool directory. The tool-level
 * versions of the same scenarios live in `locus-message-tool.test.ts`.
 */

import { readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocusMediaPort, type LarkCliRunner } from '../src/host/channel/media.js'
import {
  FIXTURE_CHAT,
  FIXTURE_IDS,
  FIXTURE_KEYS,
  FIXTURE_OTHER_CHAT,
  FIXTURE_THREAD,
  MGET_DELETED,
  MGET_POST_IMAGE,
  MGET_THREADED,
  MGET_TEXT,
  RAW_DELETED,
  RAW_POST_IMAGE,
  RAW_TEXT,
  RAW_THREADED,
  mgetEnvelope,
  rawApiEnvelope,
} from './fixtures/lark-message-envelopes.js'
import { fakeMediaCli, type FakeMediaCli } from './support/fake-media-cli.js'

function limits() {
  return {
    maxImageBytes: 4096,
    maxImagesPerMessage: 8,
    maxMessageImageBytes: 65_536,
    maxImagePixels: 1_000_000,
    maxImageDimension: 1_000,
    mediaTypes: ['image/png'] as const,
  }
}

function attachments() {
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `attachment-${String(index)}` as never,
      mediaType: item.mediaType,
      bytes: item.data.byteLength,
      width: 1,
      height: 1,
    })))
  return { saveImages, store: { imageLimits: limits(), saveImages } as never }
}

type Envelope = Record<string, unknown>

/** Runner answering `api GET` (raw) and `+messages-mget` with the given envelopes. */
function platform(raw: Envelope | Error, mget: Envelope | Error) {
  const calls: string[][] = []
  const runner = vi.fn<LarkCliRunner>(async (_binary, args) => {
    calls.push([...args])
    const answer = args.includes('+messages-mget') ? mget : args.includes('api') ? raw : new Error('unexpected command')
    if (answer instanceof Error) throw answer
    return { stdout: JSON.stringify(answer) }
  })
  return { runner, calls }
}

let fake: FakeMediaCli | undefined
afterEach(async () => {
  if (fake !== undefined) await rm(fake.root, { recursive: true, force: true })
  fake = undefined
})

async function harness(raw: Envelope | Error, mget: Envelope | Error) {
  fake = await fakeMediaCli()
  const store = attachments()
  const net = platform(raw, mget)
  const port = createLocusMediaPort({
    attachments: store.store,
    download: { binary: fake.binary, version: '1.0.97', spoolRoot: fake.spool },
    runner: net.runner,
  })
  const read = (messageId: string, chatId = FIXTURE_CHAT) => port.readMessage({
    messageId,
    chatId,
    signal: new AbortController().signal,
    canViewImages: async () => true,
  })
  return { port, store, net, read, cli: fake }
}

describe('single-message read through the media port', () => {
  it('returns text and typed image for same-chat post', async () => {
    const { read, store, net, cli } = await harness(RAW_POST_IMAGE, MGET_POST_IMAGE)
    const result = await read(FIXTURE_IDS.postImage)

    expect(result).toMatchObject({
      kind: 'ok',
      message: {
        messageId: FIXTURE_IDS.postImage,
        chatId: FIXTURE_CHAT,
        msgType: 'post',
        senderName: '测试用户',
        text: expect.stringContaining('夹具正文'),
      },
    })
    if (result.kind !== 'ok') throw new Error('unreachable')
    expect(result.media.map(part => part.type)).toEqual(['image'])
    expect(store.saveImages).toHaveBeenCalledTimes(1)
    expect(store.saveImages.mock.calls[0]?.[0]).toHaveLength(1)

    // The first read is the RAW API for exactly this message, under Pet's profile and the bot identity.
    expect(net.calls[0]).toEqual([
      '--profile', 'dsh-pet', 'api', 'GET', `/open-apis/im/v1/messages/${FIXTURE_IDS.postImage}`, '--as', 'bot',
    ])
    expect(await cli.calls()).toEqual([
      { type: 'image', fileKey: FIXTURE_KEYS.image, messageId: FIXTURE_IDS.postImage },
    ])
    expect(readdirSync(cli.spool)).toEqual([])
  })

  it('refuses foreign chat without download', async () => {
    // The raw read says the message lives in another chat.
    const rawForeign = rawApiEnvelope({
      messageId: FIXTURE_IDS.postImage,
      msgType: 'post',
      chatId: FIXTURE_OTHER_CHAT,
      content: JSON.stringify({ title: '', content: [[{ tag: 'img', image_key: FIXTURE_KEYS.image }]] }),
    })
    const first = await harness(rawForeign, MGET_POST_IMAGE)
    const refused = await first.read(FIXTURE_IDS.postImage)
    expect(refused).toEqual({ kind: 'failed', reason: 'chat-mismatch' })
    expect(JSON.stringify(refused)).not.toContain('夹具正文')
    expect(await first.cli.calls()).toEqual([])
    expect(first.store.saveImages).not.toHaveBeenCalled()
    // The foreign message body is not even fetched.
    expect(first.net.calls.some(call => call.includes('+messages-mget'))).toBe(false)
    await rm(first.cli.root, { recursive: true, force: true })

    // The two reads must agree: a formatted read from another chat is refused too.
    const second = await harness(RAW_POST_IMAGE, mgetEnvelope({
      messageId: FIXTURE_IDS.postImage, msgType: 'post', chatId: FIXTURE_OTHER_CHAT, content: '![Image](x)',
    }))
    expect(await second.read(FIXTURE_IDS.postImage)).toEqual({ kind: 'failed', reason: 'chat-mismatch' })
    expect(await second.cli.calls()).toEqual([])
    expect(second.store.saveImages).not.toHaveBeenCalled()
  })

  it('topic entrance reads group main-line message', async () => {
    // A topic entrance passes its GROUP chat id; the message is on the group main line (no thread)…
    const mainLine = await harness(RAW_TEXT, MGET_TEXT)
    const mainLineResult = await mainLine.read(FIXTURE_IDS.text)
    expect(mainLineResult).toMatchObject({
      kind: 'ok',
      message: { chatId: FIXTURE_CHAT, text: '夹具纯文本' },
    })
    if (mainLineResult.kind !== 'ok') throw new Error('unreachable')
    expect(mainLineResult.message.threadId).toBeUndefined()
    await rm(mainLine.cli.root, { recursive: true, force: true })

    // …or in a different topic of the same group: still the same chat, so it is allowed and the topic id is reported.
    const otherTopic = await harness(RAW_THREADED, MGET_THREADED)
    expect(await otherTopic.read(FIXTURE_IDS.threaded)).toMatchObject({
      kind: 'ok',
      message: { chatId: FIXTURE_CHAT, threadId: FIXTURE_THREAD },
    })
  })

  it('read failure, deleted or unparseable is a failure not empty', async () => {
    const cases: readonly { name: string; raw: Envelope | Error; mget: Envelope | Error; reason: string; id?: string }[] = [
      { name: 'raw read throws', raw: new Error('exit 1'), mget: MGET_TEXT, reason: 'platform-read-failed' },
      { name: 'formatted read throws', raw: RAW_TEXT, mget: new Error('exit 1'), reason: 'platform-read-failed' },
      { name: 'raw envelope not ok', raw: { ok: false, error: { code: 230002 } }, mget: MGET_TEXT, reason: 'envelope-invalid' },
      { name: 'raw has no items', raw: { ok: true, data: { items: [] } }, mget: MGET_TEXT, reason: 'message-not-unique' },
      {
        name: 'raw returns two items',
        raw: { ok: true, data: { items: [
          (RAW_TEXT['data'] as { items: unknown[] }).items[0],
          (RAW_TEXT['data'] as { items: unknown[] }).items[0],
        ] } },
        mget: MGET_TEXT,
        reason: 'message-not-unique',
      },
      { name: 'raw is another message', raw: RAW_TEXT, mget: MGET_TEXT, reason: 'message-mismatch', id: FIXTURE_IDS.postImage },
      { name: 'recalled message', raw: RAW_DELETED, mget: MGET_DELETED, reason: 'message-deleted', id: FIXTURE_IDS.deleted },
      {
        name: 'post body is not JSON',
        raw: rawApiEnvelope({ messageId: FIXTURE_IDS.postImage, msgType: 'post', content: '<<not json>>' }),
        mget: MGET_POST_IMAGE,
        reason: 'content-unparseable',
        id: FIXTURE_IDS.postImage,
      },
      {
        name: 'formatted read is another message',
        raw: RAW_TEXT,
        mget: mgetEnvelope({ messageId: FIXTURE_IDS.postImage, msgType: 'text', content: 'x' }),
        reason: 'message-mismatch',
      },
    ]
    for (const item of cases) {
      const run = await harness(item.raw, item.mget)
      const result = await run.read(item.id ?? FIXTURE_IDS.text)
      expect(result, item.name).toEqual({ kind: 'failed', reason: item.reason })
      expect(await run.cli.calls(), item.name).toEqual([])
      expect(run.store.saveImages, item.name).not.toHaveBeenCalled()
      await rm(run.cli.root, { recursive: true, force: true })
    }
  })

  it('rejects a message id that is not an om_ id before any platform read', async () => {
    const { read, net } = await harness(RAW_TEXT, MGET_TEXT)
    for (const bad of ['', 'oc_group', 'om_', '../../x', 'om_a b', 'om_a/../b', `om_${'a'.repeat(200)}`]) {
      expect(await read(bad), bad).toEqual({ kind: 'failed', reason: 'invalid-message-id' })
    }
    expect(net.runner).not.toHaveBeenCalled()
  })
})
