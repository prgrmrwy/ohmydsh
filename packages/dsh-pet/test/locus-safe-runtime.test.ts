import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { LOCUS_SAFE_TOOL_FILTER } from '../src/host/locus/child.js'
import { attestLocusComposition } from '../src/host/locus/composition.js'

const forbidden = [
  'bash', 'pwsh', 'write', 'edit', 'skill', 'job_output', 'job_kill',
  'create_goal', 'update_goal', 'exit_plan_mode', 'ask_user_question', 'todo_write',
  'subagent', 'subagent_fork', 'send_message', 'list_agents', 'workflow', 'ralph',
  'web_fetch',
] as const
const allowed = ['read', 'read_image', 'glob', 'grep', 'web_search'] as const

function tool(name: string, effect: () => void) {
  return defineTool({
    name,
    description: 'Synthetic safe-composition probe.',
    parameters: {},
    output: {
      schema: { type: 'boolean' },
      render: () => [{ type: 'text' as const, text: 'ok' }],
    },
    async execute() { effect(); return true },
  })
}

describe('Locus safe composition on the loaded ToolRuntime', () => {
  let ctx: Context | undefined

  afterEach(async () => {
    await ctx?.fiber.dispose()
    ctx = undefined
  })

  it('makes every ambient execution/delegation route unreachable while retaining a scoped finish', async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let effects = 0
    for (const name of [...forbidden, ...allowed]) ctx.tools.register(tool(name, () => { effects += 1 }))

    // Resolve dsh-scope from ToolRuntime's own dependency root. The repository
    // intentionally has two physical package instances; mixing them would mint
    // a scope under a different private symbol and falsely look global.
    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const scopeEntry = requireFromTools.resolve('@deepseek-ai/dsh-scope')
    const { createScope } = await import(pathToFileURL(scopeEntry).href) as {
      createScope(ctx: Context, key: Agent): { ctx: Context; dispose(): Promise<void> }
    }
    const agent = { id: 'locus-safe-child' as SessionId } as Agent
    let scope!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
      inject: ['tools', 'systemPrompt'],
    }))
    scope.ctx.tools.restrict(LOCUS_SAFE_TOOL_FILTER)
    scope.ctx.tools.register(tool('pet_locus_finish', () => { effects += 1 }))

    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual([...allowed, 'pet_locus_finish'])
    for (const name of forbidden) {
      const result = await ctx.tools.execute({
        agent,
        name,
        callId: `deny-${name}` as ToolCallId,
        arguments: {},
        signal: new AbortController().signal,
      })
      expect(result.isError, name).toBe(true)
    }
    expect((await ctx.tools.execute({
      agent,
      name: 'run_code',
      callId: 'deny-run-code' as ToolCallId,
      arguments: {},
      signal: new AbortController().signal,
    })).isError).toBe(true)
    expect(effects).toBe(0)

    expect((await ctx.tools.execute({
      agent,
      name: 'pet_locus_finish',
      callId: 'managed-finish' as ToolCallId,
      arguments: {},
      signal: new AbortController().signal,
    })).isError).toBe(false)
    expect(effects).toBe(1)

    await scope.dispose()
  })

  it('cannot filter an own-plane registration, so publication must attest it', async () => {
    // The rest of this file registers its forbidden tools on the GLOBAL layer,
    // where the filter removes them. Production's real leak came from the other
    // plane: the shipped standard preset registers its `subagent` row per agent,
    // which lands in the child's OWN layer — and `view()` applies a scope's own
    // registrations "outside the filter above", so no allow/deny can remove one.
    // This test pins that platform limit so nobody reads the filter as
    // sufficient, and ties it to the attestation that does catch the leak.
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    let effects = 0
    for (const name of allowed) ctx.tools.register(tool(name, () => { effects += 1 }))

    const requireFromTools = createRequire(require.resolve('@deepseek-ai/dsh-tools/package.json'))
    const scopeEntry = requireFromTools.resolve('@deepseek-ai/dsh-scope')
    const { createScope } = await import(pathToFileURL(scopeEntry).href) as {
      createScope(ctx: Context, key: Agent, options?: { parent?: Agent }): { ctx: Context; dispose(): Promise<void> }
    }
    const standingKey = { id: 'plane-standing' as SessionId } as Agent
    const childKey = { id: 'plane-child' as SessionId } as Agent
    let standing!: ReturnType<typeof createScope>
    let child!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => {
      standing = createScope(inner, standingKey)
      child = createScope(inner, childKey, { parent: standingKey })
    }, { inject: ['tools', 'systemPrompt'] }))

    // The preset's standing plane, where `subagent_fork` lives and is filtered.
    standing.ctx.tools.register(tool('bash', () => { effects += 1 }))
    standing.ctx.tools.register(tool('subagent_fork', () => { effects += 1 }))
    // The child's own plane, where a per-agent registration lands.
    child.ctx.tools.register(tool('subagent', () => { effects += 1 }))
    child.ctx.tools.register(tool('pet_locus_finish', () => { effects += 1 }))
    child.ctx.tools.restrict(LOCUS_SAFE_TOOL_FILTER)

    const names = ctx.tools.schemas(childKey).map(schema => schema.name)
    // Standing plane: removed exactly as the historical test asserts.
    expect(names).not.toContain('bash')
    expect(names).not.toContain('subagent_fork')
    expect(names).toContain('pet_locus_finish')
    // Own plane: still visible AND callable. A filter cannot change this.
    expect(names).toContain('subagent')
    expect((await ctx.tools.execute({
      agent: childKey,
      name: 'subagent',
      callId: 'own-plane-subagent' as ToolCallId,
      arguments: {},
      signal: new AbortController().signal,
    })).isError).toBe(false)
    expect(effects).toBe(1)

    // Which is why the safe composition is asserted, not assumed.
    expect(attestLocusComposition(names)).toEqual({
      ok: false,
      reason: 'leaked',
      leaks: ['subagent'],
    })

    await child.dispose()
    await standing.dispose()
  })
})
