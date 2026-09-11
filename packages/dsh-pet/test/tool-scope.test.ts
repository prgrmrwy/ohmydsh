/**
 * Tool-visibility scoping for the Pet trusted-context tool.
 *
 * The invariant under test is VISIBILITY, not authorization. `pet_context`
 * already fails closed for a non-Pet caller, but publishing it on the Host
 * context put it in the GLOBAL tool layer, so every ordinary DSH session
 * carried a tool that could never work for it.
 *
 * These cases drive the REAL `ToolRuntime` and the REAL `dsh-scope` primitives
 * rather than a hand-rolled double, because the whole defect was a wrong
 * assumption about that exact contract: `tools.register()` reads the scope tag
 * off the calling context and silently falls back to the global layer when
 * there is none.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { PET_CONTEXT_TOOL } from '../src/host/context-tool.js'
import { PET_LOCUS_REPLY_TOOL, registerPetTools } from '../src/host/tools.js'
import type { PetRepository } from '../src/host/repository.js'
import { openPetHarness, type PetHarness } from './harness.js'

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

/** A Host context carrying the real tool runtime, exactly as Pet sees it. */
async function hostContext(): Promise<Context> {
  const ctx = new Context()
  // `ToolRuntime` injects `systemPrompt`; without it the service never
  // publishes and `ctx.tools` reads as undefined.
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

/** Tool names one scope's model would actually be offered. */
function visibleTools(ctx: Context, scope?: unknown): string[] {
  const runtime = ctx.tools as unknown as {
    schemas(scope?: unknown): { name: string }[]
  }
  return runtime.schemas(scope).map(schema => schema.name)
}

/**
 * Install Pet's tools the way an executor Agent's `setup` does.
 *
 * The agent context is a fresh fiber that does not inherit Pet's inject
 * grants, so reading `tools` directly throws `cannot get property "tools"
 * without inject` — the registration must happen inside the injected callback.
 */
async function installOnScope(scoped: Context, repository: PetRepository): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    scoped.inject(['tools'], toolCtx => {
      try {
        registerPetTools(toolCtx, { repository })
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

describe('the Pet trusted-context tool is scoped to Pet executors', () => {
  it('is absent from the global tool surface an ordinary session sees', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()

    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository)

    // The regression: registering through the Host context put the tool in the
    // global layer, so EVERY session's model was offered `pet_context` and got
    // `NOT_A_PET_SESSION` when it tried to use it.
    expect(visibleTools(ctx)).not.toContain(PET_CONTEXT_TOOL)
  })

  it('is visible to the executor scope that installed it', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()

    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository)

    expect(visibleTools(ctx, key)).toContain(PET_CONTEXT_TOOL)
  })

  it('publishes the locus reply tool only when a caller-bound reply port is installed', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    await new Promise<void>((resolve, reject) => {
      scope.ctx.inject(['tools'], toolCtx => {
        try {
          registerPetTools(toolCtx, {
            repository: harness!.repository,
            locusRepository: { findByChildSessionId: () => [] },
            locusReply: {
              locusRepository: { findByChildSessionId: () => [] },
              lark: { reply: async () => {}, replyExact: async () => {} },
            },
          })
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
    expect(visibleTools(ctx, key)).toContain(PET_LOCUS_REPLY_TOOL)
    expect(visibleTools(ctx)).not.toContain(PET_LOCUS_REPLY_TOOL)
  })

  it('is absent from an unrelated agent scope', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()

    const petKey = {} as never
    const petScope = createScope(ctx, petKey)
    await installOnScope(petScope.ctx, harness.repository)

    // A second, non-Pet agent living in the same process.
    const otherKey = {} as never
    createScope(ctx, otherKey)

    expect(visibleTools(ctx, otherKey)).not.toContain(PET_CONTEXT_TOOL)
  })

  it('proves the Host context would publish globally, which is why it must not be used', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()

    // `tools.register()` resolves its layer from the CALLING context's scope
    // tag: an unscoped context means the global layer. This case pins that
    // upstream contract so a future refactor that reintroduces Host-context
    // registration fails here with a clear explanation.
    registerPetTools(ctx, { repository: harness.repository })

    expect(visibleTools(ctx)).toContain(PET_CONTEXT_TOOL)
  })

  it('unregisters cleanly when the executor scope goes away', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()

    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository)
    expect(visibleTools(ctx, key)).toContain(PET_CONTEXT_TOOL)

    await scope.dispose()

    // A disposed executor must not leave its tool behind for a later scope.
    expect(visibleTools(ctx)).not.toContain(PET_CONTEXT_TOOL)
  })
})
