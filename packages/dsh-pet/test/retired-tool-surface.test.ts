import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { registerPetTools, registerPetLocusMainTools } from '../src/host/tools.js'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { LOCUS_CALLER_BOUND_TOOLS } from '../src/host/locus/composition.js'

/**
 * Tasks 26.1: retired Pet tools must not appear on any reviewed own-scope
 * surface. The inquiry subsystem (`pet_inquire`, `pet_inquiry_answer`), the
 * Pet-owned collaboration context/collaborator tools, and the Locus-only
 * request/lookup tools were replaced by dsh-collab member tools and by the
 * `locus_*` tools (design 决策 11, proposal 退役清单).
 */
const RETIRED_TOOLS = [
  'pet_inquire',
  'pet_inquiry_answer',
  'pet_collaboration_context',
  'pet_collaboration_context_update',
  'pet_collaborators',
  'pet_locus_request_execution',
  'pet_locus_parent_lookup',
] as const

describe('retired Pet tool surface', () => {
  it('actual child and main registrations contain no retired tools or effect annotations', async () => {
    const ctx = new Context()
    const definitions: ToolDefinition[] = []
    ctx.provide('tools', { register: (definition: ToolDefinition) => { definitions.push(definition); return () => undefined } })
    const disposeChild = registerPetTools(ctx, {
      repository: {} as never,
      locusLifecycle: {} as never,
      intentTriage: {} as never,
      locusChildTools: {} as never,
      locusHistory: {} as never,
      locusDocContext: {} as never,
    })
    const disposeMain = registerPetLocusMainTools(ctx, {} as never)
    const names = definitions.map(definition => definition.name)
    expect(names).toEqual(expect.arrayContaining(['pet_context', 'pet_locus_finish', 'pet_locus_wait', 'pet_locus_track', 'locus_context', 'locus_ask_parent', 'locus_note', 'locus_reply_child']))
    for (const name of names) {
      expect(RETIRED_TOOLS).not.toContain(name)
      expect(name.startsWith('collab_')).toBe(false)
    }
    for (const definition of definitions) {
      expect(Reflect.get(definition.execute, Symbol.for('dsh.tool.managed-effect'))).toBeUndefined()
    }
    disposeChild()
    disposeMain()
    await ctx.fiber.dispose()
  })
  it.each(RETIRED_TOOLS)('%s is absent from the caller-bound own surface', name => {
    expect(LOCUS_CALLER_BOUND_TOOLS).not.toContain(name)
  })

  it('locus child own surface carries no collab_ tools', () => {
    expect(LOCUS_CALLER_BOUND_TOOLS.filter(name => name.startsWith('collab_'))).toEqual([])
  })
})
