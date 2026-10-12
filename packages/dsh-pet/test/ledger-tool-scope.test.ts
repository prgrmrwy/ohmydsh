/**
 * Task 9.7 — tool-visibility scoping for the three `pet-locus-intent-triage`
 * tools, using the SAME real `ToolRuntime`/`dsh-scope` primitives
 * `test/tool-scope.test.ts` established for `pet_context`/`pet_locus_finish`/
 * `pet_locus_wait` — not a hand-rolled double, so a wrong assumption about
 * `tools.register()`'s scope-tag contract cannot hide behind a mock.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  PET_LOCUS_CHAT_HISTORY_TOOL,
  PET_LOCUS_PARENT_LOOKUP_TOOL,
  PET_LOCUS_LEDGER_READ_TOOL,
  PET_LOCUS_REQUEST_EXECUTION_TOOL,
  PET_LOCUS_TRACK_TOOL,
  registerPetTools,
} from '../src/host/tools.js'
import { createLocusHistoryCursor } from '../src/host/locus/history-cursor.js'
import { requestExecutionFailureText } from '../src/host/ledger/dispatch.js'
import type { PetRepository } from '../src/host/repository.js'
import { openPetHarness, type PetHarness } from './harness.js'

// Scope tags use a package-private Symbol, so mint from ToolRuntime's OWN
// dependency root rather than the repository's second physical `dsh-scope` copy.
// Importing `createScope` from `@deepseek-ai/dsh-scope` directly yields a copy
// whose Symbol the runtime does not recognise: the scope tag then reads as
// absent and `tools.register()` SILENTLY falls back to the global layer. Making
// that mistake here is what once made this file's isolation case look like a
// product leak — every Pet tool appeared in an unrelated scope purely because
// the harness had put them in the global one.
const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
const scopeEntry = requireFromTools.resolve('@deepseek-ai/dsh-scope')
const { createScope } = await import(pathToFileURL(scopeEntry).href) as typeof import('@deepseek-ai/dsh-scope')

let harness: PetHarness | undefined

afterEach(async () => {
  await harness?.close()
  harness = undefined
})

async function hostContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function visibleTools(ctx: Context, scope?: unknown): string[] {
  const runtime = ctx.tools as unknown as { schemas(scope?: unknown): { name: string }[] }
  return runtime.schemas(scope).map(schema => schema.name)
}

async function installOnScope(
  scoped: Context,
  repository: PetRepository,
  intentTriage?: Parameters<typeof registerPetTools>[1]['intentTriage'],
  locusHistory?: Parameters<typeof registerPetTools>[1]['locusHistory'],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    scoped.inject(['tools'], toolCtx => {
      try {
        registerPetTools(toolCtx, {
          repository,
          ...(intentTriage === undefined ? {} : { intentTriage }),
          ...(locusHistory === undefined ? {} : { locusHistory }),
        })
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

const stubIntentTriage = { loci: { findByChildSessionId: () => [] } }
const CHILD_SESSION = 'child-history-1'

/**
 * The entrance read is published through the REAL ToolRuntime as well: it must
 * appear exactly when the Host supplies a read port, and stay invisible when it
 * does not — a capability that always fails must not be advertised.
 */
describe('the caller-bound entrance read is published only when assembled', () => {
  const stubHistory = {
    loci: { findByChildSessionId: () => [] },
    cursor: createLocusHistoryCursor(Buffer.alloc(32, 3)),
    read: async () => ({ messages: [], hasMore: false }),
  }

  it('registers when the Host supplies the bot read port', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository, stubIntentTriage, stubHistory)

    expect(visibleTools(ctx, key)).toContain(PET_LOCUS_CHAT_HISTORY_TOOL)
  })

  it('executes through the real tool runtime: every declared field is schema-valid', async () => {
    // The suite below asserts visibility only, and visibility does not run the
    // runtime's output validation. The first live acceptance found the gap the
    // hard way: `executeLocusChatHistory` returned a declared-nowhere `identity`
    // field, and `additionalProperties: false` turned EVERY successful read into
    // `INVALID_TOOL_OUTPUT`. Executing through the real runtime is the only way
    // this pair is checked.
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD_SESSION } as never
    const scope = createScope(ctx, key)
    const locus = {
      id: 'locus-history-1',
      generation: 1,
      endpoint: { chatId: 'oc_history' },
      parentSessionId: 'main-history-1',
      childSessionId: CHILD_SESSION,
      workspaceId: 'ws-history',
      source: 'auto' as const,
      state: 'active' as const,
      busy: false,
      createdAt: 1,
      updatedAt: 1,
    }
    await installOnScope(scope.ctx, harness.repository, { loci: { findByChildSessionId: () => [] } }, {
      loci: { findByChildSessionId: () => [locus] },
      cursor: createLocusHistoryCursor(Buffer.alloc(32, 7)),
      read: async () => ({
        messages: [{
          messageId: 'om_history_1',
          createTime: '2026-10-13T01:00:00+08:00',
          senderName: '张勇',
          text: '我们在讨论验收',
        }],
        hasMore: false,
      }),
    })

    const ok = await ctx.tools.execute({
      agent: key,
      name: PET_LOCUS_CHAT_HISTORY_TOOL,
      callId: 'history-ok' as never,
      arguments: {},
      signal: new AbortController().signal,
    }) as unknown as { content?: readonly { text?: string }[]; isError?: boolean }
    const okText = (ok.content ?? []).map(part => part.text ?? '').join('\n')

    expect(ok.isError).not.toBe(true)
    expect(okText).toContain('读取身份：bot')
    expect(okText).toContain('我们在讨论验收')

    // And the failure path is schema-valid too: never an empty history.
    const failing = await ctx.tools.execute({
      agent: key,
      name: PET_LOCUS_CHAT_HISTORY_TOOL,
      callId: 'history-fail' as never,
      arguments: { chatId: 'oc_other' },
      signal: new AbortController().signal,
    }) as unknown as { content?: readonly { text?: string }[]; isError?: boolean }
    const failText = (failing.content ?? []).map(part => part.text ?? '').join('\n')

    expect(failText).toContain('读取失败')
  })

  it('stays invisible when the runtime has no read port', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository, stubIntentTriage)

    expect(visibleTools(ctx, key)).not.toContain(PET_LOCUS_CHAT_HISTORY_TOOL)
  })
})

describe('the three pet-locus-intent-triage tools are scoped to Pet executors', () => {
  it('all three are visible to the executor scope that installed them, when intentTriage deps are supplied', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository, stubIntentTriage)

    expect(visibleTools(ctx, key)).toContain(PET_LOCUS_PARENT_LOOKUP_TOOL)
    expect(visibleTools(ctx, key)).toContain(PET_LOCUS_LEDGER_READ_TOOL)
    expect(visibleTools(ctx, key)).toContain(PET_LOCUS_TRACK_TOOL)
  })

  it('task 9.7: none of the three register at all when intentTriage deps are absent — an ordinary Pet executor (no locus) never sees them', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    // No `intentTriage` passed — matches how an ordinary (non-locus) Pet
    // executor is composed today.
    await installOnScope(scope.ctx, harness.repository)

    const visible = visibleTools(ctx, key)
    expect(visible).not.toContain(PET_LOCUS_PARENT_LOOKUP_TOOL)
    expect(visible).not.toContain(PET_LOCUS_LEDGER_READ_TOOL)
    expect(visible).not.toContain(PET_LOCUS_TRACK_TOOL)
  })

  it('REGRESSION GUARD: both production composition paths in index.ts actually pass intentTriage — a unit test calling registerPetTools directly cannot catch this', async () => {
    // This test exists because of a real defect found only at deployment:
    // `tools.ts` correctly registered the three tools *when given*
    // `intentTriage`, and every scope test above passes by supplying it by
    // hand — but neither production call site in `index.ts` actually passed
    // it, so the tools were never registered on the real Host at all.
    //
    // Both paths must pass it, for the same reason the collaboration surface
    // is installed on both: a locus child composed by Pet's own executor
    // setup and one adopted from DSH's native agent load must get the SAME
    // surface, or a child can register a todo through one path and not the
    // other.
    const fs = await import('node:fs')
    const source = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    // Slice from each call site to the start of the next one (or EOF) rather
    // than trying to brace-match with a regex — the argument object spans
    // nested closures, which no single regex reliably delimits.
    const starts = [...source.matchAll(/registerPetTools\(/g)].map(m => m.index!)
    expect(starts.length).toBeGreaterThanOrEqual(2)
    for (const [i, start] of starts.entries()) {
      const end = starts[i + 1] ?? source.length
      expect(source.slice(start, end)).toContain('intentTriage')
    }
    // `pet_locus_track` additionally needs the current-Delivery proof seam,
    // reusing the exact one `pet_locus_finish` uses.
    expect(source).toContain('currentCapability: childSessionId => currentLocusCapability(childSessionId)')
  })

  it('task 9.7: absent from an unrelated agent scope even when the Host has intentTriage-capable scopes elsewhere', async () => {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = {} as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository, stubIntentTriage)

    const otherKey = {} as never
    createScope(ctx, otherKey)

    const otherScopeVisible = visibleTools(ctx, otherKey)
    expect(otherScopeVisible).not.toContain(PET_LOCUS_PARENT_LOOKUP_TOOL)
    expect(otherScopeVisible).not.toContain(PET_LOCUS_LEDGER_READ_TOOL)
    expect(otherScopeVisible).not.toContain(PET_LOCUS_TRACK_TOOL)
  })
})

describe('model-facing tools cannot settle a todo (design D10)', () => {
  it('no model-facing tool can reach done or dropped', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const tools = await readFile(
      nodePath.resolve(__dirname, '..', 'src', 'host', 'tools.ts'),
      'utf8',
    )
    // The narrowed invariant: a model may hand work off (reach `accepted`
    // through a real dispatch), but may never declare work finished.
    //
    // Assert on CODE, not prose: the tool description legitimately says it
    // cannot mark a todo done or dropped, so a bare substring check would
    // fail on its own documentation. What must not exist is a terminal
    // status VALUE flowing through any registered tool.
    const code = tools.replace(/'(?:[^'\\]|\\.)*'/g, match =>
      match.includes(' ') ? "''" : match)
    expect(code).not.toContain("'done'")
    expect(code).not.toContain("'dropped'")
    // And the one tool that does move status exposes no status argument.
    // Slice from the REGISTRATION, not the constant declaration near the top.
    const block = tools.slice(tools.indexOf('name: PET_LOCUS_REQUEST_EXECUTION_TOOL'))
    const params = block.slice(block.indexOf('parameters: {'), block.indexOf('output: {'))
    expect(params).toContain('itemId')
    expect(params).not.toContain('status')
    expect(params).not.toContain('action')
  })
})

/**
 * Tool-level feedback: what the model actually receives when the ledger cannot
 * be read or an execution request names something it cannot resolve.
 */
describe('ledger tool feedback is actionable and never leaks ids', () => {
  const CHILD = 'child-scope-1'
  const LOCUS = {
    id: 'locus-scope-1',
    generation: 1,
    endpoint: { chatId: 'oc_scope' },
    parentSessionId: 'main-scope-1',
    childSessionId: CHILD,
    workspaceId: 'ws-scope',
    source: 'auto' as const,
    state: 'active' as const,
    busy: false,
    createdAt: 1,
    updatedAt: 1,
  }

  async function execute(
    intentTriage: Parameters<typeof registerPetTools>[1]['intentTriage'],
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    harness = await openPetHarness()
    const ctx = await hostContext()
    const key = { id: CHILD } as never
    const scope = createScope(ctx, key)
    await installOnScope(scope.ctx, harness.repository, intentTriage)
    const result = await ctx.tools.execute({
      agent: key,
      name,
      callId: `${name}-1` as never,
      arguments: args,
      signal: new AbortController().signal,
    })
    const content = (result as unknown as { content?: readonly { text?: string }[] }).content ?? []
    return {
      text: content.map(part => part.text ?? '').join('\n'),
      isError: (result as unknown as { isError?: boolean }).isError === true,
    }
  }

  it('ledger unavailable is rendered as unreadable, not as an empty ledger', async () => {
    const wired = { loci: { findByChildSessionId: () => [LOCUS] }, ledgerRead: { listForParent: () => { throw new Error('closed') } } }

    const unreadable = await execute(wired, PET_LOCUS_LEDGER_READ_TOOL, {})

    expect(unreadable.isError).toBe(false)
    expect(unreadable.text).toContain('台账读取不可用')
    expect(unreadable.text).toContain('不代表"没有待办"')
    expect(unreadable.text).not.toBe('[]')
  })

  it('an empty ledger still renders as an empty list, so the two are distinguishable', async () => {
    const wired = { loci: { findByChildSessionId: () => [LOCUS] }, ledgerRead: { listForParent: () => [] } }

    const empty = await execute(wired, PET_LOCUS_LEDGER_READ_TOOL, {})

    expect(empty.text).toBe('[]')
  })

  it('an unresolvable caller is told the read is unavailable, never that there is no work', async () => {
    const wired = { loci: { findByChildSessionId: () => [] }, ledgerRead: { listForParent: () => [] } }

    const refused = await execute(wired, PET_LOCUS_LEDGER_READ_TOOL, {})

    expect(refused.text).toContain('caller-unresolvable')
    expect(refused.text).not.toBe('[]')
  })

  // One real authorized context record: both tools below prove a current
  // Delivery before they act, so the fixture is shared rather than duplicated.
  const ACTIVE_RECORD = {
    endpoint: { chatId: 'oc_scope' },
    locus: { locusId: 'locus-scope-1', generation: 1, state: 'active' as const, toolTier: 'safe' as const },
    main: { sessionId: 'main-scope-1' },
    child: { sessionId: CHILD },
    workspace: { workspaceId: 'ws-scope' },
    permission: { effective: 'read' as const },
    contextAnchor: { status: 'unknown' as const },
    currentDelivery: {
      deliveryId: 'delivery-1',
      messageId: 'om_scope_1',
      endpoint: { chatId: 'oc_scope' },
      locusId: 'locus-scope-1',
      generation: 1,
      childSessionId: CHILD,
      status: 'current' as const,
      queueState: 'current' as const,
      executionId: 'exec-1',
    },
    source: 'locus' as const,
  }

  it('an unusable todo id points at the ledger read and enumerates nothing', async () => {
    const wired = {
      loci: { findByChildSessionId: () => [LOCUS] },
      currentCapability: () => ({
        deliveryId: 'delivery-1',
        executionId: 'exec-1',
        turnId: `${CHILD}#1`,
        source: 'delivery' as const,
      }),
      authorizeCurrentDelivery: async () => ACTIVE_RECORD,
      // The real dispatch refusal text, so this pins the render path the model sees.
      requestExecution: async () => ({ ok: false as const, reason: requestExecutionFailureText('unknown-item') }),
    }

    const refused = await execute(wired, PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: 'todo-does-not-exist' })

    expect(refused.isError).toBe(false)
    expect(refused.text).toContain('pet_locus_ledger_read')
    expect(refused.text).toContain('重试')
    // Nothing about the ledger's other rows may appear.
    expect(refused.text).not.toMatch(/item-|locus-|oc_|ou_/)
  })

  it('track executes through the real runtime with a schema-valid result', async () => {
    const registered: string[] = []
    const wired = {
      loci: { findByChildSessionId: () => [LOCUS] },
      currentCapability: () => ({
        deliveryId: 'delivery-1',
        executionId: 'exec-1',
        turnId: `${CHILD}#1`,
        source: 'delivery' as const,
      }),
      authorizeCurrentDelivery: async () => ACTIVE_RECORD,
      track: {
        store: {
          registerTodoItem: async (input: { readonly itemId: string }) => {
            registered.push(input.itemId)
            return { ...input, status: 'open' }
          },
        },
        now: () => 1,
        newItemId: () => 'todo-runtime-1',
      },
    }

    const done = await execute(wired, PET_LOCUS_TRACK_TOOL, { summary: '一句话摘要', detail: '位置、原因、建议修法' })

    // Schema validation is what failed live for the OTHER tool: an undeclared
    // field in the returned object becomes INVALID_TOOL_OUTPUT.
    expect(done.isError).toBe(false)
    expect(done.text).toContain('已登记待办')
    expect(registered).toEqual(['todo-runtime-1'])
  })

  it('a malformed todo id points at the ledger read instead of only refusing', async () => {
    const wired = { loci: { findByChildSessionId: () => [LOCUS] } }

    const refused = await execute(wired, PET_LOCUS_REQUEST_EXECUTION_TOOL, { itemId: '   ' })

    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('pet_locus_ledger_read')
  })
})
