import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  registerCollaborationContextTool, registerCollaborationContextUpdateTool, registerCollaboratorsTool,
  COLLABORATION_CONTEXT_TOOL, COLLABORATION_CONTEXT_UPDATE_TOOL, COLLABORATORS_TOOL,
} from '../src/host/collaboration/tools.js'

it('public query registration is scoped and does not grant parent child-local tools', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const parent = {} as never
    const other = {} as never
    const scoped = createScope(ctx, parent)
    createScope(ctx, other)
    let dispose: (() => void) | undefined
    await new Promise<void>((resolve, reject) => {
      scoped.ctx.inject(['tools'], toolCtx => {
        try {
          dispose = registerCollaborationContextTool(toolCtx, {
            ports: { loci: { findByChildSessionId: () => [], getLocusByChild: () => undefined, listLociByParent: () => [], getCurrentLocus: () => undefined }, inspect: async () => undefined, isArchived: () => false, hasPublicContext: () => false },
            store: { get: () => undefined },
          })
          resolve()
        } catch (error) { reject(error) }
      })
    })
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
    const names = (key?: unknown) => runtime.schemas(key).map(s => s.name)
    expect(names(parent)).toContain(COLLABORATION_CONTEXT_TOOL)
    expect(names(parent)).not.toContain('pet_context')
    expect(names(parent)).not.toContain('pet_locus_reply')
    expect(names()).not.toContain(COLLABORATION_CONTEXT_TOOL)
    expect(names(other)).not.toContain(COLLABORATION_CONTEXT_TOOL)
    dispose!()
    expect(names(parent)).not.toContain(COLLABORATION_CONTEXT_TOOL)
  } finally { await ctx.fiber.dispose() }
})

it('registers the update tool separately so a scope can stay read-only', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const ports = { loci: { findByChildSessionId: () => [], getLocusByChild: () => undefined, listLociByParent: () => [], getCurrentLocus: () => undefined }, inspect: async () => undefined, isArchived: () => false, hasPublicContext: () => false }
    const readerKey = {} as never
    const writerKey = {} as never
    const reader = createScope(ctx, readerKey)
    const writer = createScope(ctx, writerKey)
    const install = (scoped: { inject(services: string[], run: (ctx: never) => void): void }, write: boolean) =>
      new Promise<void>((resolve, reject) => {
        scoped.inject(['tools'], toolCtx => {
          try {
            registerCollaborationContextTool(toolCtx, { ports, store: { get: () => undefined } })
            if (write) {
              registerCollaborationContextUpdateTool(toolCtx, {
                ports, store: { update: async () => { throw new Error('unused') } }, now: () => 1,
              })
            }
            resolve()
          } catch (error) { reject(error) }
        })
      })
    await install(reader.ctx as never, false)
    await install(writer.ctx as never, true)
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string; parameters?: unknown }[] }
    const names = (key?: unknown) => runtime.schemas(key).map(s => s.name)
    expect(names(readerKey)).toEqual([COLLABORATION_CONTEXT_TOOL])
    expect(names(writerKey)).toContain(COLLABORATION_CONTEXT_UPDATE_TOOL)
    expect(names()).not.toContain(COLLABORATION_CONTEXT_UPDATE_TOOL)
    // No target selector: a model cannot name another scope or another author.
    const update = runtime.schemas(writerKey).find(s => s.name === COLLABORATION_CONTEXT_UPDATE_TOOL)
    expect(JSON.stringify(update?.parameters)).not.toMatch(/parentSessionId|authoredBy|sessionId|locusId/)
  } finally { await ctx.fiber.dispose() }
})

it('registers the collaborator list scoped and without a target selector', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools)
  try {
    const key = {} as never
    const scoped = createScope(ctx, key)
    await new Promise<void>((resolve, reject) => {
      scoped.ctx.inject(['tools'], toolCtx => {
        try {
          registerCollaboratorsTool(toolCtx, {
            ports: { loci: { findByChildSessionId: () => [], getLocusByChild: () => undefined, listLociByParent: () => [], getCurrentLocus: () => undefined }, inspect: async () => undefined, isArchived: () => false, hasPublicContext: () => false },
            describe: () => undefined,
          })
          resolve()
        } catch (error) { reject(error) }
      })
    })
    const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string; parameters?: unknown }[] }
    expect(runtime.schemas(key).map(s => s.name)).toEqual([COLLABORATORS_TOOL])
    expect(runtime.schemas().map(s => s.name)).not.toContain(COLLABORATORS_TOOL)
    const listed = runtime.schemas(key).find(s => s.name === COLLABORATORS_TOOL)
    expect(JSON.stringify(listed?.parameters ?? {})).not.toMatch(/parentSessionId|sessionId|locusId/)
  } finally { await ctx.fiber.dispose() }
})
