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
  PET_LOCUS_PARENT_LOOKUP_TOOL,
  PET_LOCUS_LEDGER_READ_TOOL,
  PET_LOCUS_TRACK_TOOL,
  registerPetTools,
} from '../src/host/tools.js'
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
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    scoped.inject(['tools'], toolCtx => {
      try {
        registerPetTools(toolCtx, { repository, ...(intentTriage === undefined ? {} : { intentTriage }) })
        resolve()
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })
}

const stubIntentTriage = { loci: { findByChildSessionId: () => [] } }

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
