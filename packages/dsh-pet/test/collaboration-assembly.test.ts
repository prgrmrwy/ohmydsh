/**
 * Production assembly of the scoped collaboration + inquiry surface.
 *
 * Every slice under `host/collaboration/` and `host/inquiry/` is already tested
 * in isolation. What was untested — and what this file covers — is the only
 * thing that can make all of them useless or dangerous in a real Host: WHERE
 * they get registered, WHETHER they get registered twice, and WHAT happens when
 * a seam the Host is supposed to provide is absent.
 *
 * These cases drive the REAL `ToolRuntime` and the REAL `dsh-scope` primitives,
 * exactly as `tool-scope.test.ts` does, because the whole class of defect here
 * is a wrong assumption about that contract: `tools.register()` reads the scope
 * tag off the CALLING context and silently falls back to the global layer when
 * there is none. A hand-rolled tools double is the one thing guaranteed not to
 * reproduce that, and the pitfalls note records three separate incidents where
 * a test double agreed with a broken implementation.
 *
 * `createScope(ctx, key)` alone is not enough either: an agent scope in DSH is
 * derived from a context that already HAS the `tools` inject grant (the agent
 * loop declares it and builds the agent scope from its own injected context),
 * which is why the production composer can resolve `tools` synchronously at the
 * `agent/created` boundary. Building the scope from a bare Host context instead
 * makes `ctx.tools` throw `cannot get property "tools" without inject` and would
 * "prove" fail-closed behaviour that production never exhibits. `agentScope()`
 * below reproduces the real arrangement.
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  composeCollaborationSurface,
  type CollaborationAssembly,
  type CollaborationAssemblySeams,
} from '../src/host/collaboration/assembly.js'
import {
  COLLABORATION_CONTEXT_TOOL,
  COLLABORATION_CONTEXT_UPDATE_TOOL,
  COLLABORATORS_TOOL,
} from '../src/host/collaboration/tools.js'
import {
  INQUIRY_ANSWER_TOOL,
  INQUIRY_ASK_TOOL,
  registerInquiryAskTool,
} from '../src/host/inquiry/tools.js'
import { PET_CONTEXT_TOOL } from '../src/host/context-tool.js'
import { PET_LOCUS_REPLY_TOOL, registerPetTools } from '../src/host/tools.js'
import { buildLocusRecord, type LocusRecord } from '../src/host/locus/aggregate.js'
import { LocusRepository } from '../src/host/locus/persistence.js'
import {
  createEmptyCollaborationContext,
  updateCollaborationContext,
  type AuthoredCollaborationContext,
  type CollaborationContextRecord,
} from '../src/host/collaboration/context.js'
import { createInquiry, type InquiryRecord } from '../src/host/inquiry/ledger.js'
import { openPetHarness, type PetHarness } from './harness.js'
import * as petPlugin from '../src/index.js'
import { PET_DOMAIN_NAME, petDomainSpec } from '../src/host/spec.js'

const MAIN = 'main-1'
const CHILD_A = 'child-a'
const CHILD_B = 'child-b'

/** The five tools this surface publishes, and nothing else. */
const CIRCLE_TOOLS = [
  COLLABORATION_CONTEXT_TOOL,
  COLLABORATION_CONTEXT_UPDATE_TOOL,
  COLLABORATORS_TOOL,
  INQUIRY_ASK_TOOL,
  INQUIRY_ANSWER_TOOL,
]

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

/**
 * One agent scope shaped like the runtime's.
 *
 * The agent loop declares `tools` in its own inject and derives each agent's
 * scope from that injected context, so `agentCtx.tools` resolves synchronously.
 * Reproducing that here is what makes "the composer installs at the synchronous
 * boundary" a real claim rather than an artifact of the fixture.
 */
async function agentScope(
  ctx: Context,
  sessionId: string,
): Promise<{ key: object; scope: Context; dispose: () => Promise<void> }> {
  const loopCtx = await new Promise<Context>(resolve => {
    ctx.inject(['tools'], injected => resolve(injected as Context))
  })
  const key = { session: { id: sessionId } }
  const scope = createScope(loopCtx, key as never)
  return {
    key,
    scope: scope.ctx.extend({ agent: key }) as Context,
    dispose: () => scope.dispose(),
  }
}

/** Tool names one scope's model would actually be offered. */
function visibleTools(ctx: Context, scope?: unknown): string[] {
  const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
  return runtime.schemas(scope).map(schema => schema.name)
}

function locus(
  id: string,
  child: string,
  overrides: Partial<Parameters<typeof buildLocusRecord>[0]> = {},
): LocusRecord {
  return buildLocusRecord({
    id,
    generation: 1,
    parentSessionId: MAIN,
    childSessionId: child,
    endpoint: { chatId: `chat-${id}` },
    workspaceId: 'workspace',
    source: 'explicit',
    state: 'active',
    ...overrides,
  })
}

/**
 * In-memory public-fact store that runs the REAL pure context model.
 *
 * The durable `CollaborationContextStore` requires a Domain with atomic
 * batches, which only the reviewed compatibility runtime provides (see
 * `vitest.collaboration-runtime.config.ts`); the ordinary suite's domain has
 * none and every write would reject. Substituting only the MEDIUM, while every
 * validation, revision and provenance rule stays the real one, is the same
 * discipline `inquiry-ask.test.ts` uses — and the durable store's own atomicity
 * is covered by its own opt-in suite.
 */
function memoryContextStore() {
  const rows = new Map<string, CollaborationContextRecord>()
  return {
    rows,
    get: (parentSessionId: string) => rows.get(parentSessionId),
    has: (parentSessionId: string) => rows.has(parentSessionId),
    ensure(parentSessionId: string): CollaborationContextRecord {
      const existing = rows.get(parentSessionId)
      if (existing !== undefined) return existing
      const empty = createEmptyCollaborationContext({ parentSessionId })
      rows.set(parentSessionId, empty)
      return empty
    },
    async update(
      parentSessionId: string,
      replacement: unknown,
      verifiedAuthor: unknown,
    ): Promise<AuthoredCollaborationContext> {
      const current = rows.get(parentSessionId)
      if (current === undefined) throw new Error('CONTEXT_NOT_FOUND')
      const next = updateCollaborationContext(current, replacement, verifiedAuthor)
      rows.set(parentSessionId, next)
      return next
    },
  }
}

/** In-memory inquiry ledger that delegates every rule to the real pure model. */
function memoryLedger() {
  const rows = new Map<string, InquiryRecord>()
  return {
    rows,
    get: (inquiryId: string) => rows.get(inquiryId),
    async accept(request: unknown, facts: unknown): Promise<InquiryRecord> {
      const supplied = facts as Record<string, unknown>
      const record = createInquiry(request, {
        ...supplied,
        parent: null,
        rootInquiryCount: 0,
        pendingCount: 0,
      })
      rows.set(record.id, record)
      return record
    },
    applyEvent: (): Promise<InquiryRecord> => Promise.reject(new Error('not used here')),
    recordDiagnostic: (): Promise<InquiryRecord> => Promise.reject(new Error('not used here')),
  }
}

/**
 * Seams for one composition.
 *
 * The Locus lookup is the REAL `LocusRepository` over the real Pet Domain, so a
 * fixture cannot agree with a broken assembly about what a durable row means;
 * membership is the fact this surface is built on.
 */
async function seams(
  overrides: Partial<CollaborationAssemblySeams> = {},
  rows: readonly LocusRecord[] = [locus('a', CHILD_A), locus('b', CHILD_B)],
): Promise<
  CollaborationAssemblySeams & {
    harness: PetHarness
    contexts: ReturnType<typeof memoryContextStore>
  }
> {
  harness = await openPetHarness()
  const loci = new LocusRepository(harness.domain)
  for (const row of rows) await loci.putLocus(row)
  const contexts = memoryContextStore()
  const parents = new Map<string, string | undefined>([
    [MAIN, undefined],
    [CHILD_A, MAIN],
    [CHILD_B, MAIN],
  ])
  return {
    harness,
    contexts,
    atomicStorage: true,
    loci,
    identity: {
      inspect: async (id: string) =>
        parents.has(id)
          ? { id, ...(parents.get(id) === undefined ? {} : { parentSessionId: parents.get(id)! }) }
          : undefined,
      isArchived: () => false,
    },
    contextStore: contexts,
    ledger: memoryLedger(),
    describe: (sessionId: string) => ({ title: `title ${sessionId}`, availability: 'available' }),
    origin: () => ({ origin: { kind: 'local' }, audience: { kind: 'unknown' } }),
    installed: new WeakSet<object>(),
    ...overrides,
  }
}

/** Compose and assert the surface exists, so each case reads about one thing. */
async function composed(
  overrides: Partial<CollaborationAssemblySeams> = {},
  rows?: readonly LocusRecord[],
): Promise<{
  assembly: CollaborationAssembly
  seams: Awaited<ReturnType<typeof seams>>
}> {
  const built = await seams(overrides, rows)
  const assembly = composeCollaborationSurface(built)
  expect(assembly).toBeDefined()
  return { assembly: assembly!, seams: built }
}

describe('the collaboration surface installs on circle scopes only', () => {
  it('gives a main session the shared facts, roster, ask and answer', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    expect(assembly.install(main.scope)).toBeUndefined()

    expect([...visibleTools(ctx, main.key)].sort()).toEqual([...CIRCLE_TOOLS].sort())
    await ctx.fiber.dispose()
  })

  it('never publishes any of it globally or to an unrelated agent scope', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)
    // A second, non-circle agent living in the same process.
    const stranger = await agentScope(ctx, 'unrelated-1')

    assembly.install(main.scope)

    // The regression this whole discipline exists to prevent: registering from
    // a context with no scope tag puts the tool in the GLOBAL layer, so every
    // ordinary DSH session's model is offered `pet_inquire`.
    for (const name of CIRCLE_TOOLS) {
      expect(visibleTools(ctx)).not.toContain(name)
      expect(visibleTools(ctx, stranger.key)).not.toContain(name)
    }
    await ctx.fiber.dispose()
  })

  it('proves a scope-less context would publish globally, which is why one is never passed', async () => {
    const { assembly } = await composed()
    // `tools.register()` resolves its layer from the CALLING context's scope
    // tag and falls back to the GLOBAL layer when there is none — silently,
    // with no error. This pins that upstream contract so a future refactor
    // that hands the Host context to `install` fails here with a clear
    // explanation instead of quietly offering `pet_inquire` to every session.
    const ctx = await hostContext()

    assembly.install(ctx)

    expect([...visibleTools(ctx)].sort()).toEqual([...CIRCLE_TOOLS].sort())
    await ctx.fiber.dispose()
  })

  it('refuses an ordinary session that is neither a circle parent nor a child', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const stranger = await agentScope(ctx, 'unrelated-1')

    // Eligibility is the durable hint the Host uses to decide whether to
    // install at all; an unrelated session must never reach registration.
    expect(assembly.eligible('unrelated-1')).toBe(false)
    expect(assembly.eligible(MAIN)).toBe(true)
    expect(assembly.eligible(CHILD_A)).toBe(true)

    expect(visibleTools(ctx, stranger.key)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('keeps a main session with an established record but no live child eligible', async () => {
    // The spec case: the last child left, the shared record survives, and the
    // main session may still read public facts with an empty roster.
    const { assembly, seams: built } = await composed({}, [])
    expect(assembly.eligible(MAIN)).toBe(false)
    built.contexts.ensure(MAIN)
    expect(assembly.eligible(MAIN)).toBe(true)
  })

  it('becomes installable on an already-loaded main session the moment its first locus exists', async () => {
    // The spec's "已加载主会话新增关联" case. In production the same transition is
    // driven from the provisioning commit hook, which runs only after the
    // active locus row is durable; here the durable fact itself is the thing
    // under test, because that is what decides whether the surface may be
    // installed at all — and installing before the row exists would put circle
    // tools on a session that is not yet a circle parent.
    const { assembly, seams: built } = await composed({}, [])
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    expect(assembly.eligible(MAIN)).toBe(false)

    await (built.loci as LocusRepository).putLocus(locus('a', CHILD_A))

    expect(assembly.eligible(MAIN)).toBe(true)
    assembly.install(main.scope)
    expect([...visibleTools(ctx, main.key)].sort()).toEqual([...CIRCLE_TOOLS].sort())
    await ctx.fiber.dispose()
  })

  it('adds the circle surface to a locus child beside its own pet_context and reply', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const child = await agentScope(ctx, CHILD_A)
    harness = harness!

    // Exactly what production does at the synchronous locus-child boundary:
    // the caller-bound surface first, then the circle surface on the SAME scope.
    registerPetTools(child.scope, {
      repository: harness.repository,
      locusRepository: { findByChildSessionId: () => [] },
      locusReply: {
        locusRepository: { findByChildSessionId: () => [] },
        lark: { reply: async () => {}, replyExact: async () => {} },
      },
    })
    assembly.install(child.scope)

    const names = visibleTools(ctx, child.key)
    expect(names).toContain(PET_CONTEXT_TOOL)
    expect(names).toContain(PET_LOCUS_REPLY_TOOL)
    for (const name of CIRCLE_TOOLS) expect(names).toContain(name)
    await ctx.fiber.dispose()
  })

  it('never gives a main session the child-local context or reply tools', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    assembly.install(main.scope)

    // A parent is not a Pet root executor and has no Feishu outbound: the
    // surface must not turn it into one.
    expect(visibleTools(ctx, main.key)).not.toContain(PET_CONTEXT_TOOL)
    expect(visibleTools(ctx, main.key)).not.toContain(PET_LOCUS_REPLY_TOOL)
    await ctx.fiber.dispose()
  })

  it('unregisters cleanly when the agent scope goes away', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)
    assembly.install(main.scope)

    await main.dispose()

    // A disposed circle member must not leave its tools behind for a later scope.
    for (const name of CIRCLE_TOOLS) expect(visibleTools(ctx)).not.toContain(name)
    await ctx.fiber.dispose()
  })
})

describe('installation is idempotent across repeated composition', () => {
  it('does not register the same tool twice on one agent scope', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    // A single agent really is offered this surface more than once in
    // production: `agent/created` fires, and the parent repair path runs again
    // when its first locus commits. A second registration of the same name
    // throws `tool "..." is already registered in this scope`.
    assembly.install(main.scope)
    expect(() => assembly.install(main.scope)).not.toThrow()
    expect(() => assembly.install(main.scope)).not.toThrow()

    expect(visibleTools(ctx, main.key)).toHaveLength(CIRCLE_TOOLS.length)
    expect(assembly.isInstalled(main.scope)).toBe(true)
    await ctx.fiber.dispose()
  })

  it('proves a duplicate registration really would throw, so the marker is load-bearing', async () => {
    const { assembly, seams: built } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    assembly.install(main.scope)
    // A SECOND assembly with its own marker set models the mistake this guard
    // prevents: a parallel marker discipline instead of the shared one.
    const rival = composeCollaborationSurface({ ...built, installed: new WeakSet<object>() })!
    expect(() => rival.install(main.scope)).toThrow(/already registered/)

    // And the failed installation rolled itself back rather than leaving a
    // partial surface: the original five are still exactly what is visible.
    expect([...visibleTools(ctx, main.key)].sort()).toEqual([...CIRCLE_TOOLS].sort())
    await ctx.fiber.dispose()
  })

  it('treats a fresh scope for the same session as a new installation', async () => {
    // A cold restore mints a BRAND NEW agent scope; the previous scope's
    // registrations are gone, so the marker must not suppress the new one.
    const { assembly } = await composed()
    const ctx = await hostContext()
    const first = await agentScope(ctx, MAIN)
    assembly.install(first.scope)
    await first.dispose()

    const restored = await agentScope(ctx, MAIN)
    assembly.install(restored.scope)

    expect([...visibleTools(ctx, restored.key)].sort()).toEqual([...CIRCLE_TOOLS].sort())
    await ctx.fiber.dispose()
  })
})

describe('a missing seam keeps the whole surface unpublished', () => {
  it.each([
    ['atomic storage', { atomicStorage: false }],
    ['the locus indexes', { loci: undefined }],
    ['the public-fact store', { contextStore: undefined }],
    ['the inquiry ledger', { ledger: undefined }],
    ['the caller resolver', { identity: undefined }],
    ['cold session identity', { identity: { isArchived: () => false } }],
    ['durable archive facts', { identity: { inspect: async () => undefined } }],
  ])('composes nothing without %s', async (_label, override) => {
    const built = await seams(override as Partial<CollaborationAssemblySeams>)

    // `undefined`, not a degraded surface: publishing tools whose every call is
    // guaranteed to fail is worse than not publishing them, because a model
    // spends a turn discovering it.
    expect(composeCollaborationSurface(built)).toBeUndefined()
  })

  it('leaves an eligible agent scope completely untouched when nothing composed', async () => {
    const built = await seams({ atomicStorage: false })
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    const assembly = composeCollaborationSurface(built)
    expect(assembly).toBeUndefined()

    // Pet keeps working exactly as before: the scope has whatever it had, and
    // no half-composed circle surface appeared anywhere.
    expect(visibleTools(ctx, main.key)).toEqual([])
    expect(visibleTools(ctx)).toEqual([])
    await ctx.fiber.dispose()
  })

  it('refuses an agent scope that exposes no tools service, without partial registration', async () => {
    const { assembly } = await composed()
    // A scope with no `tools` at all: the surface must refuse rather than
    // register whatever happens to resolve from an outer context.
    const bare = new Context()

    expect(() => assembly.install(bare)).toThrow(/no tools service/)
    expect(assembly.isInstalled(bare)).toBe(false)
  })

  it('rolls back every registration it already made when a later one fails', async () => {
    const { assembly, seams: built } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)

    // Occupy the FOURTH name the assembly registers, so the three before it
    // succeed and then the ask tool collides. Without rollback the scope would
    // be left with shared facts and a roster but no way to ask anything — a
    // half-composed surface no later pass repairs, because the marker discipline
    // would still consider a retry a duplicate.
    registerInquiryAskTool(main.scope, {
      ports: {
        loci: built.loci!,
        inspect: built.identity!.inspect!,
        isArchived: built.identity!.isArchived!,
        hasPublicContext: () => false,
      },
      store: built.ledger!,
      origin: built.origin,
      now: () => 0,
      newInquiryId: () => 'x',
    })
    const before = visibleTools(ctx, main.key)
    expect(before).toEqual([INQUIRY_ASK_TOOL])

    expect(() => assembly.install(main.scope)).toThrow(/already registered/)

    // Exactly what was there before: no partial surface survived.
    expect(visibleTools(ctx, main.key)).toEqual(before)
    expect(assembly.isInstalled(main.scope)).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports an unreadable locus index as not eligible rather than installing on a guess', async () => {
    const { assembly } = await composed({
      loci: {
        findByChildSessionId: () => {
          throw new Error('index unreadable')
        },
        getLocusByChild: () => undefined,
        listLociByParent: () => [],
        getCurrentLocus: () => undefined,
      },
    })

    expect(assembly.eligible(MAIN)).toBe(false)
    expect(assembly.eligible(CHILD_A)).toBe(false)
  })
})

describe('inquiry dispatch reports unavailable instead of throwing', () => {
  it('resolves unavailable on this Host because the driver carries no marker', async () => {
    const { assembly } = await composed()

    // The pinned runtime has no isolated queued-turn claim seam, so the real
    // detector finds no marker. This must be a VERDICT, not an exception and
    // not a silent "available": a claim that sweeps pending GUI input would
    // destroy user input that can never be re-delivered.
    expect(assembly.inquiryDispatch).toEqual({ available: false, reason: 'agent-loop-missing' })
    expect(assembly.scheduler.isolatedQueuedTurnClaimSupport()).toEqual(assembly.inquiryDispatch)
  })

  it('stays unavailable when a driver declares the marker but no probe corroborates it', async () => {
    // The exact delivery gap the capability audit recorded: a patched
    // `dsh-agent-loop` resolving against an UNPATCHED `dsh-agent`, so the
    // marker was present while the claim still swept GUI input.
    const { assembly } = await composed({
      agentLoop: { supportsIsolatedQueuedTurnClaim: true },
    })

    expect(assembly.inquiryDispatch).toEqual({ available: false, reason: 'probe-missing' })
  })

  it('refuses to dispatch a queued inquiry and leaves it exactly where it was', async () => {
    const { assembly } = await composed()
    const accepted = assembly.scheduler.acceptInquiry({
      inquiryId: 'inquiry-1',
      requesterSessionId: CHILD_A,
      targetSessionId: CHILD_B,
    })
    expect(accepted.accepted).toBe(true)

    const dispatched = assembly.scheduler.dispatch(CHILD_B, [
      { messageId: 'msg-1', origin: 'inquiry', ref: 'inquiry-1' },
    ])

    // Deterministic refusal with nothing consumed: no segment, no phase change,
    // and the inquiry stays queued so a rebuilt runtime can run it later.
    expect(dispatched).toEqual({
      dispatched: false,
      reason: 'isolated-claim-unsupported',
      inquiryId: 'inquiry-1',
      stillQueued: true,
    })
    expect(assembly.scheduler.occupiesRunSlot(CHILD_B)).toBe(false)
  })

  it('still accepts and durably queues an inquiry, and says so without claiming an answer', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const child = await agentScope(ctx, CHILD_A)
    assembly.install(child.scope)

    const result = await ctx.tools.execute({
      agent: child.key as never,
      name: INQUIRY_ASK_TOOL,
      callId: 'call-1' as never,
      arguments: {
        target: `child:b:1:${CHILD_B}`,
        question: 'Which endpoint did you settle on?',
        purpose: 'Deciding whether to reuse it for my own request.',
      },
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    const payload = JSON.parse((result.value as { json: string }).json) as {
      status: string
      answered: boolean
    }
    // Acceptance is not an answer, and the tool says that literally rather than
    // leaving the model to infer it from a missing field.
    expect(payload.status).toBe('accepted')
    expect(payload.answered).toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports circle members as not inquirable while dispatch is unavailable', async () => {
    const { assembly } = await composed()
    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)
    assembly.install(main.scope)

    const result = await ctx.tools.execute({
      agent: main.key as never,
      name: COLLABORATORS_TOOL,
      callId: 'call-1' as never,
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    const roster = JSON.parse((result.value as { json: string }).json) as {
      members: { sessionId: string; reachability: string; title?: string }[]
    }
    expect(roster.members.map(member => member.sessionId).sort()).toEqual([CHILD_A, CHILD_B])
    // `unknown` is the roster's documented "do not assume it is reachable"
    // value. Reporting a loaded sibling as `available` would invite a model to
    // spend a turn on an inquiry no runtime can dispatch. The title survives:
    // it is traceable metadata, not a reachability claim.
    for (const member of roster.members) {
      expect(member.reachability).toBe('unknown')
      expect(member.title).toBe(`title ${member.sessionId}`)
    }
    await ctx.fiber.dispose()
  })

  it('reports real reachability once dispatch is genuinely available', async () => {
    // Proves the narrowing above is tied to the verdict rather than hard-coded:
    // a Host with both the marker AND a corroborating probe reports normally.
    const { assembly } = await composed({
      agentLoop: { supportsIsolatedQueuedTurnClaim: true },
      probeIsolatedClaim: (fixture: { nextStepId: string; nextTurnId: string }) => ({
        claimedMessageIds: [fixture.nextTurnId],
        pendingNextStepIds: [fixture.nextStepId],
      }),
    })
    expect(assembly.inquiryDispatch).toEqual({ available: true })

    const ctx = await hostContext()
    const main = await agentScope(ctx, MAIN)
    assembly.install(main.scope)
    const result = await ctx.tools.execute({
      agent: main.key as never,
      name: COLLABORATORS_TOOL,
      callId: 'call-1' as never,
      arguments: {},
      signal: new AbortController().signal,
    })
    const roster = JSON.parse((result.value as { json: string }).json) as {
      members: { reachability: string }[]
    }
    expect(roster.members.every(member => member.reachability === 'available')).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('every call re-authorizes, whatever the scope still shows', () => {
  it('refuses a roster call from a scope whose locus has since been retired', async () => {
    const { assembly, seams: built } = await composed()
    const ctx = await hostContext()
    const child = await agentScope(ctx, CHILD_A)
    assembly.install(child.scope)

    // Retire the caller's own locus AFTER the tools were installed. The tool
    // stays visible — Pet cannot retract a published tool from a live scope —
    // so the body is what must refuse.
    const loci = built.loci as LocusRepository
    await loci.putLocus(locus('c', 'child-c', { state: 'retired' }))
    await loci.invalidateLocus('a', 'retired for this test', Date.now(), undefined, {
      evenWithPendingWork: true,
    })

    const result = await ctx.tools.execute({
      agent: child.key as never,
      name: COLLABORATORS_TOOL,
      callId: 'call-1' as never,
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(visibleTools(ctx, child.key)).toContain(COLLABORATORS_TOOL)
    await ctx.fiber.dispose()
  })
})

/**
 * The REAL plugin entry, not the assembly in isolation.
 *
 * Everything above proves the assembly behaves correctly when someone calls it.
 * This suite proves `src/index.ts` actually calls it, from the entry points
 * that exist — which is the distinction the integration-pitfalls note is
 * entirely about: `meta.agentPreset` type-checked, logged fine, and composed
 * nothing, because the code that would have composed it was never invoked.
 *
 * The composition needs a Domain with ATOMIC BATCHES, because the assembly
 * refuses to publish without one. The ordinary devDependency storage stack has
 * none; the reviewed compatibility artifacts under `compat/subagent/` do, and
 * they are the ones the launcher actually ships. Their identity and provenance
 * are verified before use, exactly as `vitest.collaboration-runtime.config.ts`
 * does, so this can never silently run against an unreviewed build — and it
 * skips rather than weakening the check when the artifacts are absent.
 */

const ARTIFACT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../compat/subagent/storage-artifacts',
)
const ATOMIC_VERSION = '0.1.2-rc.1-locus-atomic.1'
const ATOMIC_PROVENANCE = {
  upstreamBase: 'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
  patchSha256: '18ec93c5240612b513871d65db2d100ee6165ea1ba251dbf91e670963dd35bed',
}

/** Whether the reviewed atomic storage artifacts are present to load. */
function atomicArtifactsPresent(): boolean {
  return ['storage', 'storage-domain', 'storage-sqlite'].every(name =>
    existsSync(path.join(ARTIFACT_ROOT, name, 'lib', 'index.js')),
  )
}

/**
 * Load one reviewed artifact, proving its identity and patch provenance first.
 * @param directory - artifact directory under `storage-artifacts`; the package
 *   name it must declare is `@deepseek-ai/dsh-<directory>`, read from the real
 *   manifest rather than assumed from the path.
 */
async function loadAtomicArtifact(directory: string): Promise<Record<string, unknown>> {
  const root = path.join(ARTIFACT_ROOT, directory)
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    name?: string
    version?: string
    dsh_compat?: { upstreamBase?: string; patchSha256?: string }
  }
  // Never load an artifact whose identity, version or patch provenance differs
  // from the reviewed one: a test that silently accepts a different build is
  // exactly how an unreviewed seam becomes "already tested".
  expect(manifest.name).toBe(`@deepseek-ai/dsh-${directory}`)
  expect(manifest.version).toBe(ATOMIC_VERSION)
  expect(manifest.dsh_compat).toMatchObject(ATOMIC_PROVENANCE)
  return (await import(
    /* @vite-ignore */ pathToFileURL(path.join(root, 'lib', 'index.js')).href
  )) as Record<string, unknown>
}

/** Stand-ins for the DSH services Pet injects, plus the recorders under test. */
interface LoadedHost {
  ctx: Context
  routes: { path: string }[]
  /** Emit `agent/created` exactly as the runtime's registry announce does. */
  publish(sessionId: string, scope: Context): void
  toolNames(scope?: unknown): string[]
  agentScope(sessionId: string): Promise<{ key: object; scope: Context }>
  close(): Promise<void>
}

/**
 * Compose the real Pet plugin over the reviewed atomic storage stack and a REAL
 * tool runtime, so `tools.register()` resolves real scope layers.
 *
 * Locus rows are seeded BEFORE Pet applies, because Pet opens the Pet Domain
 * exclusively for the process; a second `open` is refused by the real storage
 * layer. Seeding first is also the honest shape: a cold restore finds durable
 * rows that already existed, it does not create them.
 * @param seed - locus rows to make durable before Pet initializes.
 */
async function loadPetHost(seed: readonly LocusRecord[] = []): Promise<LoadedHost> {
  const [Storage, Sqlite, Domain] = await Promise.all([
    loadAtomicArtifact('storage'),
    loadAtomicArtifact('storage-sqlite'),
    loadAtomicArtifact('storage-domain'),
  ])
  const home = await mkdtemp(path.join(tmpdir(), 'pet-assembly-'))
  const routes: { path: string }[] = []
  const live = new Map<string, { ctx: Context; session: { id: string } }>()

  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage.default as never)
  ctx.provide('webServer', {
    register: (route: { path: string }) => {
      routes.push(route)
      return () => {}
    },
  })
  ctx.provide('connection', { requestRejection: () => undefined })
  ctx.provide('workspaceRegistry', {
    create: async (p: string) => ({ id: 'ws-pet', path: p, title: 'DSH Pet' }),
    list: () => [],
    get: (id: string) =>
      id === 'ws-pet' ? { id, path: '/pet', title: 'DSH Pet', sessionIds: [] } : undefined,
    archivedSessionIds: [],
  })
  // A locus child's composition applies its file policy through the official
  // free function `setSandboxMode`, which appends a `sandbox/mode` event to the
  // exact Session, and then READS BACK what the policy service resolved. Both
  // halves are modelled here: a session that records appended modes, and a
  // policy service that answers from those records. A stand-in that accepted
  // the write without reflecting it would let a child be published with a
  // permission the Host never actually applied.
  const appliedModes = new Map<string, string>()
  ctx.provide('sessions', {
    list: () => [],
    get: (id: string) =>
      live.has(id)
        ? {
          id,
          header: {},
          snapshotEvents: () => [],
          seq: 0,
          append: (type: string, data: { mode?: string }) => {
            if (type === 'sandbox/mode' && typeof data?.mode === 'string') {
              appliedModes.set(id, data.mode)
            }
            return { type, data, seq: 0 }
          },
        }
        : undefined,
  })
  ctx.provide('sandboxPolicy', {
    resolve: (input: { session?: { id?: string } }) => {
      const id = input?.session?.id
      const mode = id === undefined ? undefined : appliedModes.get(id)
      return mode === undefined ? undefined : { mode }
    },
  })
  ctx.provide('sessionController', {
    inspect: async (id: string) => {
      // Cold identity: the main session has no parent; each child names it.
      if (id === MAIN) return { meta: { id } }
      if (id === CHILD_A || id === CHILD_B) return { meta: { id, parentSession: MAIN } }
      throw new Error(`session "${id}" not found`)
    },
    resolveAgent: async () => undefined,
  })
  ctx.provide('agents', {
    create: async () => ({ session: { id: 'x' } }),
    get: (id: string) => live.get(id),
    resume: async () => undefined,
    list: () => [],
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'anthropic', model: 'claude-opus-5' }),
  })
  ctx.provide('agentPresets', { list: async () => [], mount: async () => {} })
  ctx.provide('llm', { listProviders: () => [{ id: 'anthropic', name: 'Anthropic' }] })
  ctx.provide('sessionTitle', {
    rename: () => ({}),
    get: (session: { id?: string } | undefined) =>
      session?.id === undefined ? undefined : { title: `title ${session.id}` },
  })
  ctx.provide('skills', { register: () => () => {}, registerProvider: () => () => {} })

  await ctx.plugin({
    name: 'default-backend',
    inject: ['storage'],
    async apply(outer: Context) {
      await outer.plugin(
        {
          name: 'default-backend-inner',
          inject: ['storage'],
          apply(inner: Context, config: unknown) {
            const backend = new (Sqlite.SqliteStorageBackend as new (c: unknown) => unknown)(config)
            inner.effect(() => inner.storage.backend.register('json', backend as never))
            inner.provide(
              (Storage.storageBackendServiceKey as (n: string) => string)('json'),
              backend,
            )
          },
          Config: Sqlite.Config,
        } as never,
        { path: ':memory:' },
      )
    },
  })
  await ctx.plugin(Sqlite as never, { path: path.join(home, 'plugins', 'dsh-pet', 'state.sqlite') })
  await ctx.plugin(Domain as never, { backend: 'json', routes: { [PET_DOMAIN_NAME]: 'sqlite' } })

  if (seed.length > 0) {
    const seeded = await ctx.storageDomain.open(petDomainSpec)
    const repository = new LocusRepository(seeded)
    for (const row of seed) await repository.putLocus(row)
    await seeded.close()
  }

  await ctx.plugin(petPlugin, { home, version: '0.1.0' })

  // Pet's initialization is contained and asynchronous; poll for its observable
  // end state rather than guessing a delay.
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && routes.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  expect(routes.length).toBeGreaterThan(0)

  return {
    ctx,
    routes,
    publish(sessionId, scope) {
      ctx.emit('agent/created' as never, { agent: { session: { id: sessionId }, ctx: scope } } as never)
    },
    toolNames: scope =>
      (ctx.tools as unknown as { schemas(s?: unknown): { name: string }[] })
        .schemas(scope)
        .map(schema => schema.name),
    agentScope: async sessionId => {
      const built = await agentScope(ctx, sessionId)
      live.set(sessionId, { ctx: built.scope, session: { id: sessionId } })
      return built
    },
    close: async () => {
      await ctx.fiber.dispose()
    },
  }
}

describe.skipIf(!atomicArtifactsPresent())('the real plugin entry installs the surface', () => {
  it('scopes a main session and its locus child on agent/created, and nobody else', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)])
    try {
      const main = await host.agentScope(MAIN)
      const child = await host.agentScope(CHILD_A)
      const stranger = await host.agentScope('unrelated-1')

      // Cold restore / native GUI load: DSH republishes an existing session.
      host.publish(MAIN, main.scope)
      host.publish(CHILD_A, child.scope)
      host.publish('unrelated-1', stranger.scope)
      await new Promise(resolve => setTimeout(resolve, 50))

      for (const name of CIRCLE_TOOLS) {
        expect(host.toolNames(main.key)).toContain(name)
        expect(host.toolNames(child.key)).toContain(name)
        // The leak this whole discipline exists to prevent.
        expect(host.toolNames()).not.toContain(name)
        expect(host.toolNames(stranger.key)).not.toContain(name)
      }
      // A main session is not a Pet root executor and gets no Delivery reply.
      expect(host.toolNames(main.key)).not.toContain(PET_CONTEXT_TOOL)
      expect(host.toolNames(main.key)).not.toContain(PET_LOCUS_REPLY_TOOL)
    } finally {
      await host.close()
    }
  })

  it('stays idempotent across repeated agent/created for the same scope', async () => {
    const host = await loadPetHost([locus('a', CHILD_A)])
    try {
      const main = await host.agentScope(MAIN)

      // Republishing the same agent must not attempt a second registration; a
      // duplicate would throw `already registered` inside the listener and,
      // worse, the repair paths would keep retrying it forever.
      host.publish(MAIN, main.scope)
      host.publish(MAIN, main.scope)
      host.publish(MAIN, main.scope)
      await new Promise(resolve => setTimeout(resolve, 50))

      const names = host.toolNames(main.key)
      for (const name of CIRCLE_TOOLS) {
        expect(names.filter(candidate => candidate === name)).toHaveLength(1)
      }
    } finally {
      await host.close()
    }
  })

  it('installs nothing before a main session actually has a circle', async () => {
    const host = await loadPetHost()
    try {
      // No locus, no shared record: an ordinary session Pet must not touch.
      const main = await host.agentScope(MAIN)
      host.publish(MAIN, main.scope)
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(host.toolNames(main.key)).toEqual([])
    } finally {
      await host.close()
    }
  })
})
