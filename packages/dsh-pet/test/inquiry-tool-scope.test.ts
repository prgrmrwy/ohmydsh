/**
 * Registration-surface tests for the two inquiry tools.
 *
 * These prove the SHAPE a model sees: scoped registration, no recipient or
 * parent selector, and no way to name an audience, an origin or a delivery.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  registerInquiryAskTool, registerInquiryAnswerTool,
  INQUIRY_ASK_TOOL, INQUIRY_ANSWER_TOOL,
} from '../src/host/inquiry/tools.js'

// Scope tags use a package-private Symbol, so mint from ToolRuntime's own
// dependency root rather than the repository's second physical dsh-scope copy.
const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const scopeEntry = requireFromTools.resolve('@deepseek-ai/dsh-scope')
const { createScope } = await import(pathToFileURL(scopeEntry).href) as typeof import('@deepseek-ai/dsh-scope')

const ports = {
  loci: {
    findByChildSessionId: () => [], getLocusByChild: () => undefined,
    listLociByParent: () => [], getCurrentLocus: () => undefined,
  },
  inspect: async () => undefined,
  isArchived: () => false,
  hasPublicContext: () => false,
}

const askDeps = {
  ports,
  store: { accept: async () => { throw new Error('unused') } },
  origin: () => undefined,
  now: () => 1,
  newInquiryId: () => 'inquiry-1',
}

const answerDeps = {
  ports,
  ledger: {
    get: () => undefined,
    applyEvent: async () => { throw new Error('unused') },
    recordDiagnostic: async () => { throw new Error('unused') },
  },
  answers: { get: () => undefined, put: async () => { throw new Error('unused') } },
  now: () => 1,
  newEventId: () => 'event-1',
}

async function withTools(run: (scope: unknown, schemas: (key?: unknown) => { name: string; parameters?: unknown; description?: string }[]) => void, install: (toolCtx: never) => void) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const key = {} as never
    const scoped = createScope(ctx, key)
    await new Promise<void>((resolve, reject) => {
      scoped.ctx.inject(['tools'], toolCtx => {
        try { install(toolCtx as never); resolve() } catch (error) { reject(error) }
      })
    })
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string; parameters?: unknown; description?: string }[] }
    run(key, k => runtime.schemas(k))
  } finally { await ctx.fiber.dispose() }
}

it('registers the ask tool scoped, with no parent, requester, audience or delivery selector', async () => {
  await withTools((key, schemas) => {
    expect(schemas(key).map(s => s.name)).toEqual([INQUIRY_ASK_TOOL])
    expect(schemas().map(s => s.name)).not.toContain(INQUIRY_ASK_TOOL)
    const tool = schemas(key)[0]!
    const declared = tool.parameters as { properties: Record<string, unknown>; required?: string[] }
    // Only a roster reference, the question and the purpose may be named. An
    // exact key set is the assertion: an extra selector cannot hide in it.
    expect(Object.keys(declared.properties).sort()).toEqual(['purpose', 'question', 'target'])
    expect([...(declared.required ?? [])].sort()).toEqual(['purpose', 'question', 'target'])
    for (const name of Object.keys(declared.properties)) {
      expect(name).not.toMatch(/parentSessionId|requester|audience|origin|chat|delivery|recipient|^to$/i)
    }
    // And no identifier a model could use to aim the answer elsewhere.
    expect(JSON.stringify(declared)).not.toMatch(/chatId|deliveryId|messageId|sessionId|locusId/)
    // Accepted is not answered, and the description must say so.
    expect(tool.description?.toLowerCase()).toContain('not an answer')
  }, toolCtx => { registerInquiryAskTool(toolCtx, askDeps as never) })
})

it('registers the answer tool scoped, with no recipient selector of any kind', async () => {
  await withTools((key, schemas) => {
    expect(schemas(key).map(s => s.name)).toEqual([INQUIRY_ANSWER_TOOL])
    expect(schemas().map(s => s.name)).not.toContain(INQUIRY_ANSWER_TOOL)
    const tool = schemas(key)[0]!
    const declared = tool.parameters as { properties: Record<string, unknown>; required?: string[] }
    const properties = Object.keys(declared.properties).sort()
    expect(properties).toEqual(['answer', 'confidence', 'inquiryId', 'recency', 'sources'])
    expect([...(declared.required ?? [])].sort()).toEqual(properties)
    for (const name of properties) {
      expect(name).not.toMatch(/^to$|recipient|answeredBy|parentSessionId|audience|chat|delivery|target/i)
    }
    expect(JSON.stringify(declared)).not.toMatch(/chatId|deliveryId|messageId|sessionId|locusId/)
    // The distinctions are a closed vocabulary, not free prose.
    expect((declared.properties.confidence as { enum: string[] }).enum).toEqual(['confirmed', 'suggested', 'unknown'])
    expect((declared.properties.recency as { enum: string[] }).enum)
      .toEqual(['current', 'as-of-recorded-work', 'stale', 'unknown'])
  }, toolCtx => { registerInquiryAnswerTool(toolCtx, answerDeps as never) })
})

it('registers each capability independently so a scope can ask without being answerable', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const askerKey = {} as never
    const answererKey = {} as never
    const asker = createScope(ctx, askerKey)
    const answerer = createScope(ctx, answererKey)
    const install = (scoped: { inject(services: string[], run: (ctx: never) => void): void }, both: boolean) =>
      new Promise<void>((resolve, reject) => {
        scoped.inject(['tools'], toolCtx => {
          try {
            registerInquiryAskTool(toolCtx, askDeps as never)
            if (both) registerInquiryAnswerTool(toolCtx, answerDeps as never)
            resolve()
          } catch (error) { reject(error) }
        })
      })
    await install(asker.ctx as never, false)
    await install(answerer.ctx as never, true)
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
    expect(runtime.schemas(askerKey).map(s => s.name)).toEqual([INQUIRY_ASK_TOOL])
    expect(runtime.schemas(answererKey).map(s => s.name)).toContain(INQUIRY_ANSWER_TOOL)
    expect(runtime.schemas().map(s => s.name)).not.toContain(INQUIRY_ANSWER_TOOL)
    // Neither tool leaks into the Host plugin context.
    expect(runtime.schemas().map(s => s.name)).not.toContain(INQUIRY_ASK_TOOL)
  } finally { await ctx.fiber.dispose() }
})

it('disposes cleanly, removing the capability from the scope', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const key = {} as never
    const scoped = createScope(ctx, key)
    let dispose: (() => void) | undefined
    await new Promise<void>((resolve, reject) => {
      scoped.ctx.inject(['tools'], toolCtx => {
        try { dispose = registerInquiryAskTool(toolCtx, askDeps as never); resolve() } catch (error) { reject(error) }
      })
    })
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
    expect(runtime.schemas(key).map(s => s.name)).toContain(INQUIRY_ASK_TOOL)
    dispose!()
    expect(runtime.schemas(key).map(s => s.name)).not.toContain(INQUIRY_ASK_TOOL)
  } finally { await ctx.fiber.dispose() }
})
