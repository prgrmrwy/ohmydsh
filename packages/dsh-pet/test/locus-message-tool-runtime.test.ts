/**
 * `pet_locus_message` through the REAL `ToolRuntime`.
 *
 * `locus-message-tool.test.ts` pins the executor. This file pins what only the
 * runtime can: the tool is published exactly when the Host assembled it, its
 * output (`additionalProperties: false`) is schema-valid for success, failure
 * and image results — an undeclared field turns every success into
 * `INVALID_TOOL_OUTPUT` (docs/architecture/dsh-plugin-integration-pitfalls.md)
 * — and the image reaches the model as a real image content block.
 */

import { createRequire } from 'node:module'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createLocusMediaPort, type LarkCliRunner } from '../src/host/channel/media.js'
import { LOCUS_MESSAGE_DESCRIPTION, PET_LOCUS_MESSAGE_TOOL } from '../src/host/locus-message-tool.js'
import { attestLocusComposition, LOCUS_CALLER_BOUND_TOOLS, LOCUS_SAFE_TOOL_NAMES } from '../src/host/locus/composition.js'
import { selectLocusEntryReadTools } from '../src/host/locus/entry-read-tools.js'
import { publishesLocusMessageTool } from '../src/host/locus/message-guidance.js'
import { renderLocusDeliveryFor } from '../src/host/locus/context.js'
import { registerPetTools } from '../src/host/tools.js'
import type { LocusResolvedRowV20 } from '../src/host/locus/contract-v20.js'
import type { PetRepository } from '../src/host/repository.js'
import { openPetHarness, type PetHarness } from './harness.js'
import {
  FIXTURE_CHAT,
  FIXTURE_IDS,
  FIXTURE_OTHER_CHAT,
  MGET_POST_IMAGE,
  RAW_POST_IMAGE,
  mgetEnvelope,
  rawApiEnvelope,
} from './fixtures/lark-message-envelopes.js'
import { fakeMediaCli, type FakeMediaCli } from './support/fake-media-cli.js'
import { FIXTURE_LINK, FIXTURE_LINKED_ID, RAW_LINKED_TEXT, linkQueryEnvelope } from './fixtures/lark-message-link-envelopes.js'
import { runTool } from './support/tool-call.js'

// Same scope-tag caveat as `ledger-tool-scope.test.ts`: mint scopes from the runtime's own `dsh-scope`.
const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const { createScope } = await import(pathToFileURL(requireFromTools.resolve('@deepseek-ai/dsh-scope')).href) as typeof import('@deepseek-ai/dsh-scope')

const CHILD = 'child-message-1'
const LINKED = 'pet_locus_linked_message'
let harness: PetHarness | undefined
let cli: FakeMediaCli | undefined
afterEach(async () => {
  await harness?.close()
  harness = undefined
  if (cli !== undefined) await rm(cli.root, { recursive: true, force: true })
  cli = undefined
})

async function hostContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  return ctx
}

const visible = (ctx: Context, scope: unknown): string[] =>
  (ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }).schemas(scope).map(schema => schema.name)

function resolvedRow(chatId: string) {
  const row = { endpoint: { chatId }, locusId: 'locus-message-1', sessionId: CHILD, state: 'active' as const, accessMode: 'read-only' as const }
  return { row, locusMainSessionId: 'main-message-1', workspaceId: 'ws-message' } as unknown as LocusResolvedRowV20
}

async function install(
  scope: Context,
  repository: PetRepository,
  deps: Partial<Parameters<typeof registerPetTools>[1]>,
): Promise<void> {
  await new Promise<void>((done, fail) => {
    scope.inject(['tools'], toolCtx => {
      try {
        registerPetTools(toolCtx, { repository, ...deps })
        done()
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
    })
  })
}

async function messageDeps(options: { canViewImages?: boolean } = {}) {
  cli = await fakeMediaCli()
  const saveImages = vi.fn(async (items: readonly { data: Uint8Array; mediaType: string }[]) =>
    items.map((item, index) => ({
      attachmentId: `att-${String(index)}` as never, mediaType: item.mediaType, bytes: item.data.byteLength, width: 4, height: 3,
    })))
  const runner = vi.fn<LarkCliRunner>(async (_binary, args) => ({
    stdout: JSON.stringify(args.includes('+messages-mget') ? MGET_POST_IMAGE : RAW_POST_IMAGE),
  }))
  const media = createLocusMediaPort({
    attachments: {
      imageLimits: {
        maxImageBytes: 4096, maxImagesPerMessage: 8, maxMessageImageBytes: 65_536,
        maxImagePixels: 1_000_000, maxImageDimension: 1_000, mediaTypes: ['image/png'],
      },
      saveImages,
    } as never,
    download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
    runner,
  })
  return {
    saveImages,
    deps: {
      loci: { findBySessionId: (id: string) => id === CHILD ? resolvedRow(FIXTURE_CHAT) : undefined },
      media,
      routeAcceptsImages: async () => options.canViewImages ?? true,
    },
  }
}

describe('pet_locus_message in the real tool runtime', () => {
  it('is published exactly when the Host assembled it, and is on the reviewed allowlist', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const withTool = {} as never
    const without = {} as never
    const { deps } = await messageDeps()
    await install(createScope(ctx, withTool).ctx, harness.repository, { locusMessage: deps as never })
    await install(createScope(ctx, without).ctx, harness.repository, {})

    expect(visible(ctx, withTool)).toContain(PET_LOCUS_MESSAGE_TOOL)
    expect(visible(ctx, without)).not.toContain(PET_LOCUS_MESSAGE_TOOL)
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain(PET_LOCUS_MESSAGE_TOOL)
  })

  it('history description names pet_locus_message only when the tool is registered', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const history = { loci: { findBySessionId: () => undefined }, cursor: {} as never, read: async () => undefined }
    const withTool = {} as never
    const without = {} as never
    const { deps } = await messageDeps()
    await install(createScope(ctx, withTool).ctx, harness.repository, { locusHistory: history as never, locusMessage: deps as never })
    await install(createScope(ctx, without).ctx, harness.repository, { locusHistory: history as never })
    const describe = (scope: never): string => (ctx.tools as unknown as { schemas(scope?: unknown): { name: string; description?: string }[] })
      .schemas(scope).find(schema => schema.name === 'pet_locus_chat_history')?.description ?? ''
    expect(describe(withTool)).toContain(PET_LOCUS_MESSAGE_TOOL)
    expect(describe(without)).toContain('(id om_')
    expect(describe(without)).not.toContain(PET_LOCUS_MESSAGE_TOOL)
  })

  it('doc child surface excludes pet_locus_message', async () => {
    // A document child is assembled with the doc read only; the runtime then has no message tool for it.
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    await install(createScope(ctx, key).ctx, harness.repository, {
      locusDocContext: { loci: { findBySessionId: () => undefined }, currentMessageId: () => undefined, client: {} as never },
    })
    const names = visible(ctx, key)
    expect(names).toContain('pet_locus_doc_context')
    expect(names).not.toContain(PET_LOCUS_MESSAGE_TOOL)
    expect(names).not.toContain(LINKED)
    expect(names).not.toContain('pet_locus_chat_history')
  })

  /**
   * The PRODUCTION selection (`selectLocusEntryReadTools`, the function the Host's
   * composition `install` spreads into `registerPetTools`) driven through the real
   * runtime for IM / topic / document × media available / unavailable.
   */
  async function surfaceFor(endpoint: { chatId: string; threadId?: string }, mediaAvailable: boolean) {
    harness ??= await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const { deps } = await messageDeps()
    const media = mediaAvailable ? deps.media : { available: false, diagnostic: 'test', admitCurrentImage: async () => ({ kind: 'unavailable', reason: 'x', content: [] }) }
    const selected = selectLocusEntryReadTools({
      endpoint,
      lark: {
        readEntranceHistory: async () => undefined,
        queryDocComment: async () => ({ ok: false }) as never,
        fetchDocMarkdown: async () => ({ ok: false }),
      },
      media: media as never,
      loci: deps.loci as never,
      cursor: {} as never,
      currentDocMessageId: () => undefined,
    })
    await install(createScope(ctx, key).ctx, harness.repository, selected as never)
    const schemas = (ctx.tools as unknown as { schemas(scope?: unknown): { name: string; description?: string }[] }).schemas(key)
    return {
      names: schemas.map(schema => schema.name),
      historyDescription: schemas.find(schema => schema.name === 'pet_locus_chat_history')?.description ?? '',
    }
  }

  it('doc child surface excludes chat history and pet_locus_message', async () => {
    for (const available of [true, false]) {
      const { names } = await surfaceFor({ chatId: 'doc:docx:Dx0000000000000000000000001' }, available)
      expect(names, String(available)).toContain('pet_locus_doc_context')
      expect(names, String(available)).not.toContain('pet_locus_chat_history')
      expect(names, String(available)).not.toContain(PET_LOCUS_MESSAGE_TOOL)
    }
  })

  it('media unavailable: an IM child is published without pet_locus_message and still attests', async () => {
    for (const endpoint of [{ chatId: FIXTURE_CHAT }, { chatId: FIXTURE_CHAT, threadId: 'omt_00000001' }]) {
      const off = await surfaceFor(endpoint, false)
      expect(off.names).toContain('pet_locus_chat_history')
      expect(off.names).not.toContain(PET_LOCUS_MESSAGE_TOOL)
      expect(off.historyDescription).not.toContain(PET_LOCUS_MESSAGE_TOOL)
      expect(attestLocusComposition([...LOCUS_SAFE_TOOL_NAMES, ...off.names], 'read-only')).toEqual({ ok: true, leaks: [] })
      // The prompt is rendered with the SAME decision and therefore does not name the tool either.
      const prompt = renderLocusDeliveryFor({
        record: { locusId: 'l', endpoint, locusMainSessionId: 'm', sessionId: CHILD, workspaceId: 'w', state: 'active', accessMode: 'read-only' },
        message: { messageId: 'om_trigger', senderOpenId: 'ou_x', text: 'hi', replyToMessageId: 'om_replied' },
        deliveries: [],
        messageToolAvailable: publishesLocusMessageTool(endpoint, false),
      })
      expect(prompt).not.toContain(PET_LOCUS_MESSAGE_TOOL)

      const on = await surfaceFor(endpoint, true)
      expect(on.names).toContain(PET_LOCUS_MESSAGE_TOOL)
      expect(on.historyDescription).toContain(PET_LOCUS_MESSAGE_TOOL)
      expect(attestLocusComposition([...LOCUS_SAFE_TOOL_NAMES, ...on.names], 'read-only')).toEqual({ ok: true, leaks: [] })
    }
  })

  const DOC_ENDPOINT = { chatId: 'doc:docx:Dx0000000000000000000000001', threadId: '7' }
  const MATRIX = [
    { label: 'group', endpoint: { chatId: FIXTURE_CHAT } },
    { label: 'topic', endpoint: { chatId: FIXTURE_CHAT, threadId: 'omt_00000001' } },
    { label: 'doc', endpoint: DOC_ENDPOINT },
  ] as const

  /** Render the way the Host does, for a first and a follow-up delivery of the same child. */
  function hostPrompts(endpoint: { chatId: string; threadId?: string }, mediaAvailable: boolean) {
    const isDoc = endpoint.chatId.startsWith('doc:')
    const messageId = isDoc ? `${endpoint.chatId}/7/2` : 'om_trigger'
    const record = { locusId: 'l', endpoint, locusMainSessionId: 'm', sessionId: CHILD, workspaceId: 'w', state: 'active' as const, accessMode: 'read-only' as const }
    const message = {
      messageId, senderOpenId: 'ou_x', text: 'hi', replyToMessageId: isDoc ? `${endpoint.chatId}/7/1` : 'om_replied',
      replyTarget: { chatId: endpoint.chatId, ...(endpoint.threadId === undefined ? {} : { threadId: endpoint.threadId }), messageId },
      ...(isDoc ? { docComment: { quote: 'q' } } : {}),
    }
    const messageToolAvailable = publishesLocusMessageTool(endpoint, mediaAvailable)
    const first = renderLocusDeliveryFor({ record, message: message as never, deliveries: [], currentDeliveryId: 'd2', messageToolAvailable })
    // A prior Delivery bound into this child's inbox is the durable proof that makes the next one a follow-up.
    const subsequent = renderLocusDeliveryFor({
      record, message: message as never, currentDeliveryId: 'd2', messageToolAvailable,
      deliveries: [{ sessionId: CHILD, deliveryId: 'd1', inboxMessageId: 'inbox-1' }, { sessionId: CHILD, deliveryId: 'd2' }],
    })
    return { first, subsequent }
  }

  it('surface, attestation and Host-rendered prompts agree for IM/topic/doc × media available/unavailable', async () => {
    for (const { label, endpoint } of MATRIX) {
      for (const available of [true, false]) {
        const tag = `${label}/${String(available)}`
        const surface = await surfaceFor(endpoint, available)
        const published = surface.names.includes(PET_LOCUS_MESSAGE_TOOL)
        expect(published, tag).toBe(label !== 'doc' && available)
        expect(attestLocusComposition([...LOCUS_SAFE_TOOL_NAMES, ...surface.names], 'read-only'), tag).toEqual({ ok: true, leaks: [] })
        if (label === 'doc') {
          expect(surface.names, tag).toContain('pet_locus_doc_context')
          expect(surface.names, tag).not.toContain('pet_locus_chat_history')
        } else {
          expect(surface.historyDescription.includes(PET_LOCUS_MESSAGE_TOOL), tag).toBe(published)
        }
        const prompts = hostPrompts(endpoint, available)
        expect(prompts.first, tag).not.toContain('沿用本 child 首次投递')
        expect(prompts.subsequent, tag).toContain('沿用本 child 首次投递')
        for (const [position, prompt] of Object.entries(prompts)) {
          // The prompt names the tool exactly when the child was given it.
          expect(prompt.includes(PET_LOCUS_MESSAGE_TOOL), `${tag}/${position}`).toBe(published)
          if (label !== 'doc') expect(prompt, `${tag}/${position}`).toContain('om_replied')
        }
      }
    }
  })

  it('a cold-restored active child is composed through the same selection and runtime', async () => {
    const { handleLocusAgentCreated } = await import('../src/host/locus/agent-created.js')
    for (const { label, endpoint } of MATRIX) {
      for (const available of [true, false]) {
        const tag = `${label}/${String(available)}`
        let restored: { endpoint: { chatId: string; threadId?: string } } | undefined
        const row = {
          endpoint, locusId: 'locus-r', sessionId: CHILD, state: 'active', accessMode: 'read-only',
          revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M', workspaceId: 'w',
        }
        const outcome = await handleLocusAgentCreated({
          repository: {
            lookupChildForAgentCreated: () => ({ kind: 'active', row: { row, locusMainSessionId: 'M', workspaceId: 'w' } }) as never,
            recordAccessVerified: async () => ({}) as never,
            markInvalid: async () => ({}) as never,
          },
          agentPreset: () => 'locus-child',
          staged: () => undefined,
          claimStaged: () => {},
          // The restored composition (built from the durable row) is what the Host's install receives.
          compose: (_candidate: unknown, composition: { endpoint: { chatId: string; threadId?: string } }) => {
            restored = composition
            return { composed: true, composition, accessMode: 'read-only' } as never
          },
          publishClaimed: async () => {},
          now: () => 1,
        } as never, { id: CHILD })
        expect(outcome, tag).toBe('composed')
        // The endpoint came from the durable row, not from the test.
        expect(restored?.endpoint, tag).toEqual(endpoint)
        const { names } = await surfaceFor(restored!.endpoint, available)
        expect(names.includes(PET_LOCUS_MESSAGE_TOOL), tag).toBe(label !== 'doc' && available)
        expect(attestLocusComposition([...LOCUS_SAFE_TOOL_NAMES, ...names], 'read-only'), tag).toEqual({ ok: true, leaks: [] })
      }
    }
  })

  it('executes through the runtime: text and a real image block, schema-valid', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD } as never
    const { deps } = await messageDeps()
    await install(createScope(ctx, key).ctx, harness.repository, { locusMessage: deps as never })

    const ok = await runTool(ctx, {
      agent: key, name: PET_LOCUS_MESSAGE_TOOL, callId: 'message-ok' as never,
      arguments: { messageId: FIXTURE_IDS.postImage }, signal: new AbortController().signal,
    }) as unknown as { content?: readonly { type: string; text?: string; attachment?: { attachmentId: string } }[]; isError?: boolean }

    expect(ok.isError).not.toBe(true)
    const blocks = ok.content ?? []
    expect(blocks.map(block => block.type)).toEqual(['text', 'image'])
    expect(blocks[0]!.text).toContain('夹具正文')
    expect(blocks[1]!.attachment?.attachmentId).toBe('att-0')
    expect(JSON.stringify(blocks)).not.toContain('INVALID_TOOL_OUTPUT')
  })

  it('executes through the runtime: failures and refused arguments are schema-valid too', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD } as never
    const { deps } = await messageDeps()
    await install(createScope(ctx, key).ctx, harness.repository, { locusMessage: deps as never })
    const call = async (args: unknown) => {
      const result = await runTool(ctx, {
        agent: key, name: PET_LOCUS_MESSAGE_TOOL, callId: `message-${JSON.stringify(args)}` as never,
        arguments: args, signal: new AbortController().signal,
      }) as unknown as { content?: readonly { text?: string }[]; isError?: boolean }
      return (result.content ?? []).map(block => block.text ?? '').join('\n')
    }

    const extra = await call({ messageId: FIXTURE_IDS.postImage, chatId: 'oc_other' })
    expect(extra).toContain('invalid-request')
    expect(extra).not.toContain('INVALID_TOOL_OUTPUT')
    const missing = await call({ messageId: 'om_nope' })
    expect(missing).toMatch(/pet_locus_message 失败|platform-read-failed|message-mismatch|chat-mismatch|envelope-invalid/)
    expect(missing).not.toContain('INVALID_TOOL_OUTPUT')
  })

  it('a text-only model route gets text and no download through the runtime', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD } as never
    const { deps, saveImages } = await messageDeps({ canViewImages: false })
    await install(createScope(ctx, key).ctx, harness.repository, { locusMessage: deps as never })
    const result = await runTool(ctx, {
      agent: key, name: PET_LOCUS_MESSAGE_TOOL, callId: 'message-text' as never,
      arguments: { messageId: FIXTURE_IDS.postImage }, signal: new AbortController().signal,
    }) as unknown as { content?: readonly { type: string; text?: string }[] }
    expect((result.content ?? []).map(block => block.type)).toEqual(['text', 'text'])
    expect(JSON.stringify(result.content)).toContain('当前模型无法查看图片')
    expect(saveImages).not.toHaveBeenCalled()
    expect(await cli!.calls()).toEqual([])
  })

  it('the description points message links to pet_locus_linked_message', () => {
    expect(LOCUS_MESSAGE_DESCRIPTION).toContain('message/link/open')
    expect(LOCUS_MESSAGE_DESCRIPTION).toContain(LINKED)
    expect(LOCUS_MESSAGE_DESCRIPTION).toContain('转发')
  })

  it('doc child surface excludes pet_locus_linked_message', async () => {
    for (const available of [true, false]) {
      const { names } = await surfaceFor({ chatId: 'doc:docx:Dx0000000000000000000000001', threadId: '7' }, available)
      expect(names, String(available)).not.toContain(LINKED)
      expect(names, String(available)).not.toContain(PET_LOCUS_MESSAGE_TOOL)
    }
  })

  it('IM/topic × create/cold-restore publish both message tools and attest', async () => {
    const { handleLocusAgentCreated } = await import('../src/host/locus/agent-created.js')
    expect(LOCUS_CALLER_BOUND_TOOLS).toContain(LINKED)
    for (const { label, endpoint } of MATRIX.filter(item => item.label !== 'doc')) {
      for (const available of [true, false]) {
        for (const path of ['create', 'cold-restore'] as const) {
          const tag = `${label}/${String(available)}/${path}`
          let composed = endpoint as { chatId: string; threadId?: string }
          if (path === 'cold-restore') {
            const row = {
              endpoint, locusId: 'locus-r', sessionId: CHILD, state: 'active', accessMode: 'read-only',
              revision: 3, createdAt: 1, updatedAt: 1, locusMainSessionId: 'M', workspaceId: 'w',
            }
            let restored: { endpoint: { chatId: string; threadId?: string } } | undefined
            await handleLocusAgentCreated({
              repository: {
                lookupChildForAgentCreated: () => ({ kind: 'active', row: { row, locusMainSessionId: 'M', workspaceId: 'w' } }) as never,
                recordAccessVerified: async () => ({}) as never,
                markInvalid: async () => ({}) as never,
              },
              agentPreset: () => 'locus-child',
              staged: () => undefined,
              claimStaged: () => {},
              compose: (_candidate: unknown, composition: { endpoint: { chatId: string; threadId?: string } }) => {
                restored = composition
                return { composed: true, composition, accessMode: 'read-only' } as never
              },
              publishClaimed: async () => {},
              now: () => 1,
            } as never, { id: CHILD })
            composed = restored!.endpoint
          }
          const { names, historyDescription } = await surfaceFor(composed, available)
          // One decision: both message tools, or neither.
          expect(names.includes(PET_LOCUS_MESSAGE_TOOL), tag).toBe(available)
          expect(names.includes(LINKED), tag).toBe(available)
          expect(historyDescription.includes(LINKED), tag).toBe(available)
          expect(attestLocusComposition([...LOCUS_SAFE_TOOL_NAMES, ...names], 'read-only'), tag).toEqual({ ok: true, leaks: [] })
        }
      }
    }
  })

  it('executes pet_locus_linked_message through the runtime: success and failures are schema-valid', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD } as never
    cli = await fakeMediaCli()
    const sourceId = FIXTURE_IDS.text
    const runner = vi.fn<LarkCliRunner>(async (_binary, args) => {
      if (args.includes('/open-apis/im/v1/message_links/query')) return { stdout: JSON.stringify(linkQueryEnvelope()) }
      const target = args.some(arg => arg.includes(FIXTURE_LINKED_ID))
      if (args.includes('+messages-mget')) {
        return { stdout: JSON.stringify(target
          ? mgetEnvelope({ messageId: FIXTURE_LINKED_ID, msgType: 'text', chatId: FIXTURE_OTHER_CHAT, content: '来源正文' })
          : mgetEnvelope({ messageId: sourceId, msgType: 'text', content: 'x' })) }
      }
      return { stdout: JSON.stringify(target ? RAW_LINKED_TEXT : rawApiEnvelope({
        messageId: sourceId, msgType: 'text', content: JSON.stringify({ text: `看${FIXTURE_LINK}` }),
      })) }
    })
    const media = createLocusMediaPort({
      attachments: { imageLimits: { maxImageBytes: 4096, maxImagesPerMessage: 8, maxMessageImageBytes: 65_536, maxImagePixels: 1_000_000, maxImageDimension: 1_000, mediaTypes: ['image/png'] }, saveImages: vi.fn() } as never,
      download: { binary: cli.binary, version: '1.0.97', spoolRoot: cli.spool },
      runner,
    })
    await install(createScope(ctx, key).ctx, harness.repository, {
      locusMessage: { loci: { findBySessionId: (id: string) => id === CHILD ? resolvedRow(FIXTURE_CHAT) : undefined }, media, routeAcceptsImages: async () => true } as never,
    })
    const call = async (args: unknown) => {
      const result = await runTool(ctx, {
        agent: key, name: LINKED, callId: `linked-${JSON.stringify(args)}` as never,
        arguments: args, signal: new AbortController().signal,
      }) as unknown as { content?: readonly { text?: string }[]; isError?: boolean }
      return (result.content ?? []).map(block => block.text ?? '').join('\n')
    }
    const ok = await call({ messageId: sourceId })
    expect(ok).toContain('<linked-message>')
    expect(ok).toContain('来源正文')
    expect(ok).not.toContain('INVALID_TOOL_OUTPUT')
    const refused = await call({ messageId: sourceId, url: FIXTURE_LINK })
    expect(refused).toMatch(/invalid-request|INVALID_ARGUMENTS|unexpected|not allowed|additional/i)
    expect(refused).not.toContain('INVALID_TOOL_OUTPUT')
  })
})
