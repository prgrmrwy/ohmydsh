/**
 * `pet_locus_message`: the caller-bound single-message read.
 *
 * The tool runs over the REAL media port: platform envelopes are the redacted
 * fixtures, downloads go through the fake official CLI into a real spool. What
 * is under test here is the tool's own contract — caller binding, argument
 * refusal, entrance scoping, model-route gating, post-read caller re-proof —
 * on top of the port behaviour `locus-media-message.test.ts` already pins.
 */

import { readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocusMediaPort, type LarkCliRunner } from '../src/host/channel/media.js'
import {
  executeLocusMessage,
  PET_LOCUS_MESSAGE_TOOL,
  renderLocusMessage,
  routeAcceptsImages,
  type LocusMessageToolResult,
} from '../src/host/locus-message-tool.js'
import type { LocusResolvedRowV20 } from '../src/host/locus/contract-v20.js'
import {
  FIXTURE_CHAT,
  FIXTURE_IDS,
  FIXTURE_KEYS,
  FIXTURE_OTHER_CHAT,
  FIXTURE_THREAD,
  MGET_DELETED,
  MGET_POST_IMAGE,
  MGET_TEXT,
  RAW_DELETED,
  RAW_POST_IMAGE,
  RAW_TEXT,
  mgetEnvelope,
  rawApiEnvelope,
} from './fixtures/lark-message-envelopes.js'
import { fakeMediaCli, type FakeMediaCli } from './support/fake-media-cli.js'

type Envelope = Record<string, unknown>

function storeWithLimits() {
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `attachment-${String(index)}` as never,
      mediaType: item.mediaType,
      bytes: item.data.byteLength,
      width: 1,
      height: 1,
    })))
  return {
    saveImages,
    store: {
      imageLimits: {
        maxImageBytes: 4096, maxImagesPerMessage: 8, maxMessageImageBytes: 65_536,
        maxImagePixels: 1_000_000, maxImageDimension: 1_000, mediaTypes: ['image/png'] as const,
      },
      saveImages,
    } as never,
  }
}

/** A mutable child→locus mapping so a test can change the association mid-call. */
function lookupOf(endpoint: { chatId: string; threadId?: string }) {
  const state = { locusId: 'locus-1', child: 'child-1' }
  const loci = {
    findBySessionId: (id: string) => id === state.child
      ? ({
        row: { locusId: state.locusId, sessionId: state.child, state: 'active', endpoint },
        locusMainSessionId: 'main',
        workspaceId: 'ws-1',
      } as unknown as LocusResolvedRowV20)
      : undefined,
  }
  return { state, loci }
}

let cli: FakeMediaCli | undefined
afterEach(async () => {
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  cli = undefined
})

async function harness(options: {
  raw?: Envelope | Error
  mget?: Envelope | Error
  endpoint?: { chatId: string; threadId?: string }
  canViewImages?: boolean
  onPlatformRead?: () => void
} = {}) {
  cli = await fakeMediaCli()
  const store = storeWithLimits()
  const calls: string[][] = []
  const raw = options.raw ?? RAW_POST_IMAGE
  const mget = options.mget ?? MGET_POST_IMAGE
  const runner = vi.fn<LarkCliRunner>(async (_binary, args) => {
    calls.push([...args])
    options.onPlatformRead?.()
    const answer = args.includes('+messages-mget') ? mget : raw
    if (answer instanceof Error) throw answer
    return { stdout: JSON.stringify(answer) }
  })
  const media = createLocusMediaPort({
    attachments: store.store,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner,
  })
  const lookup = lookupOf(options.endpoint ?? { chatId: FIXTURE_CHAT })
  const canViewImages = vi.fn(async () => options.canViewImages ?? true)
  const call = (args: unknown, overrides: { loci?: typeof lookup.loci; caller?: string } = {}) => executeLocusMessage(args, {
    callerSessionId: overrides.caller ?? 'child-1',
    loci: overrides.loci ?? lookup.loci,
    media,
    canViewImages,
    signal: new AbortController().signal,
  })
  return { call, lookup, calls, runner, cli, store, canViewImages }
}

function okOf(result: LocusMessageToolResult) {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`)
  return result
}

describe('pet_locus_message', () => {
  it('is named pet_locus_message', () => {
    expect(PET_LOCUS_MESSAGE_TOOL).toBe('pet_locus_message')
  })

  it('returns text and typed image for same-chat post', async () => {
    const h = await harness()
    const result = okOf(await h.call({ messageId: FIXTURE_IDS.postImage }))

    expect(result.text).toContain('测试用户')
    expect(result.text).toContain('夹具正文')
    expect(result.text).toContain(FIXTURE_IDS.postImage)
    // Untrusted-input label precedes the body.
    expect(result.text.indexOf('不可信')).toBeGreaterThanOrEqual(0)
    expect(result.text.indexOf('不可信')).toBeLessThan(result.text.indexOf('夹具正文'))
    expect(result.parts.map(part => part.type)).toEqual(['image'])

    // The render hands the model the text first, then the real image block.
    const blocks = renderLocusMessage(result)
    expect(blocks.map(block => block.type)).toEqual(['text', 'image'])
    expect(blocks[1]).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png' } })
    expect(await h.cli.calls()).toEqual([{ type: 'image', fileKey: FIXTURE_KEYS.image, messageId: FIXTURE_IDS.postImage }])
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it('refuses foreign chat without download', async () => {
    const foreign = rawApiEnvelope({
      messageId: FIXTURE_IDS.postImage, msgType: 'post', chatId: FIXTURE_OTHER_CHAT,
      content: JSON.stringify({ title: '', content: [[{ tag: 'img', image_key: FIXTURE_KEYS.image }]] }),
    })
    const h = await harness({ raw: foreign })
    const result = await h.call({ messageId: FIXTURE_IDS.postImage })
    expect(result).toEqual({ ok: false, reason: 'chat-mismatch' })
    expect(JSON.stringify(result)).not.toContain('夹具正文')
    expect(await h.cli.calls()).toEqual([])
    expect(h.store.saveImages).not.toHaveBeenCalled()
    expect(renderLocusMessage(result)[0]).toMatchObject({ type: 'text' })
    expect(JSON.stringify(renderLocusMessage(result))).toContain('chat-mismatch')
  })

  it('topic entrance reads group main-line message', async () => {
    // The caller serves a topic of FIXTURE_CHAT; the message sits on the group main line.
    const h = await harness({ raw: RAW_TEXT, mget: MGET_TEXT, endpoint: { chatId: FIXTURE_CHAT, threadId: FIXTURE_THREAD } })
    const result = okOf(await h.call({ messageId: FIXTURE_IDS.text }))
    expect(result.text).toContain('夹具纯文本')
    expect(result.parts).toEqual([])
    // The group id, not the topic, is what the platform answer was checked against.
    expect(h.calls[0]).toContain(`/open-apis/im/v1/messages/${FIXTURE_IDS.text}`)
  })

  it('read failure, deleted or unparseable is a failure not empty', async () => {
    const cases: readonly { name: string; raw: Envelope | Error; mget: Envelope | Error; id: string; reason: string }[] = [
      { name: 'platform error', raw: new Error('exit 1'), mget: MGET_TEXT, id: FIXTURE_IDS.text, reason: 'platform-read-failed' },
      { name: 'deleted', raw: RAW_DELETED, mget: MGET_DELETED, id: FIXTURE_IDS.deleted, reason: 'message-deleted' },
      {
        name: 'unparseable',
        raw: rawApiEnvelope({ messageId: FIXTURE_IDS.postImage, msgType: 'post', content: '<<not json>>' }),
        mget: MGET_POST_IMAGE, id: FIXTURE_IDS.postImage, reason: 'content-unparseable',
      },
      {
        name: 'other message',
        raw: RAW_TEXT, mget: mgetEnvelope({ messageId: FIXTURE_IDS.postImage, msgType: 'text', content: 'x' }),
        id: FIXTURE_IDS.text, reason: 'message-mismatch',
      },
    ]
    for (const item of cases) {
      const h = await harness({ raw: item.raw, mget: item.mget })
      const result = await h.call({ messageId: item.id })
      expect(result, item.name).toEqual({ ok: false, reason: item.reason })
      const rendered = renderLocusMessage(result)
      expect(rendered, item.name).toHaveLength(1)
      expect(JSON.stringify(rendered), item.name).toContain(item.reason)
      expect(JSON.stringify(rendered), item.name).toContain('不是')
      await rm(h.cli.root, { recursive: true, force: true })
    }
  })

  it('text-only route returns text and downloads nothing', async () => {
    const h = await harness({ canViewImages: false })
    const result = okOf(await h.call({ messageId: FIXTURE_IDS.postImage }))
    expect(result.text).toContain('夹具正文')
    expect(result.parts.every(part => part.type === 'text')).toBe(true)
    expect(JSON.stringify(result.parts)).toContain('当前模型无法查看图片')
    expect(h.canViewImages).toHaveBeenCalledTimes(1)
    expect(await h.cli.calls()).toEqual([])
    expect(h.store.saveImages).not.toHaveBeenCalled()
  })

  it('rejects any argument besides messageId before platform read', async () => {
    const h = await harness()
    for (const args of [
      { messageId: FIXTURE_IDS.postImage, chatId: FIXTURE_OTHER_CHAT },
      { messageId: FIXTURE_IDS.postImage, threadId: 'omt_x' },
      { messageId: FIXTURE_IDS.postImage, fileKey: FIXTURE_KEYS.image },
      { messageId: FIXTURE_IDS.postImage, url: 'https://example.com/x' },
      { messageId: FIXTURE_IDS.postImage, path: '/etc/passwd' },
      {},
      { messageId: 123 },
      { messageId: '' },
      { messageId: 'oc_group' },
      [FIXTURE_IDS.postImage],
      'om_x',
      null,
      undefined,
    ]) {
      expect(await h.call(args), JSON.stringify(args)).toEqual({ ok: false, reason: 'invalid-request' })
    }
    expect(h.runner).not.toHaveBeenCalled()
    expect(h.canViewImages).not.toHaveBeenCalled()
  })

  it('refuses an unresolvable caller and a document entrance before any read', async () => {
    const h = await harness()
    expect(await h.call({ messageId: FIXTURE_IDS.postImage }, { caller: 'someone-else' }))
      .toEqual({ ok: false, reason: 'caller-unavailable' })
    const doc = lookupOf({ chatId: 'doc:docx:Dx0000000000000000000000001' })
    expect(await h.call({ messageId: FIXTURE_IDS.postImage }, { loci: doc.loci }))
      .toEqual({ ok: false, reason: 'not-an-im-entrance' })
    expect(h.runner).not.toHaveBeenCalled()
  })

  it('drops the result when the caller association changes during the read', async () => {
    const holder: { flip?: () => void } = {}
    const h = await harness({ onPlatformRead: () => holder.flip?.() })
    // The child is replaced by another generation while the platform is answering.
    holder.flip = () => { h.lookup.state.locusId = 'locus-2' }
    const result = await h.call({ messageId: FIXTURE_IDS.postImage })
    expect(result).toEqual({ ok: false, reason: 'caller-changed' })
    expect(JSON.stringify(result)).not.toContain('夹具正文')
    // Whatever was downloaded before the re-proof is gone from the spool.
    expect(readdirSync(h.cli.spool)).toEqual([])
  })

  it('reports an unavailable media port as a failure', async () => {
    const lookup = lookupOf({ chatId: FIXTURE_CHAT })
    const media = createLocusMediaPort({})
    const result = await executeLocusMessage({ messageId: FIXTURE_IDS.postImage }, {
      callerSessionId: 'child-1', loci: lookup.loci, media, canViewImages: async () => true, signal: new AbortController().signal,
    })
    expect(result).toEqual({ ok: false, reason: 'media-unavailable' })
  })
})

describe('model route image capability probe', () => {
  const exec = (over: Record<string, unknown> = {}) => ({
    signal: new AbortController().signal,
    agent: {
      options: { provider: 'p0', model: 'm0' },
      session: { requestHeader: () => ({ config: { provider: 'p1', model: 'm1' } }) },
    },
    ...over,
  })
  const llm = (modalities: readonly string[] | undefined, seen: string[] = []) => ({
    resolveModelInfo: async (provider: string, model: string) => {
      seen.push(`${provider}/${model}`)
      return modalities === undefined ? {} : { inputModalities: modalities }
    },
  })

  it('asks the exact route the request header names, falling back to the agent options', async () => {
    const seen: string[] = []
    expect(await routeAcceptsImages({ get: () => llm(['text', 'image'], seen) }, exec())).toBe(true)
    expect(await routeAcceptsImages({ get: () => llm(['text', 'image'], seen) }, exec({
      agent: { options: { provider: 'p0', model: 'm0' }, session: { requestHeader: () => undefined } },
    }))).toBe(true)
    expect(seen).toEqual(['p1/m1', 'p0/m0'])
  })

  it('treats anything it cannot prove as not supported', async () => {
    expect(await routeAcceptsImages({ get: () => llm(['text']) }, exec())).toBe(false)
    expect(await routeAcceptsImages({ get: () => llm(undefined) }, exec())).toBe(false)
    expect(await routeAcceptsImages({ get: () => undefined }, exec())).toBe(false)
    expect(await routeAcceptsImages({ get: () => llm(['image']) }, exec({ agent: undefined }))).toBe(false)
    expect(await routeAcceptsImages({ get: () => ({ resolveModelInfo: async () => { throw new Error('boom') } }) }, exec())).toBe(false)
  })
})
