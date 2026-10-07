import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createRegistryProvider } from '../src/registry-provider.js'
import { createOpenSpecSkillProvider } from '../src/provider.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"

async function harness(check = async () => ({ installed: '1.13.2', available: '1.13.3', managementEntry: 'dsh-openspec-manage' })) {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const adapter = createOpenSpecSkillProvider({ skills: [{ name: 'opsx-test', body: 'official body' }], generationId: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'enabled', check })
  const generations = { list: async () => [{ name: 'opsx-test', description: 'd' }], get: (candidate: any, options: any) => adapter.get(candidate, options) }
  ctx.skills.registerProvider(() => createRegistryProvider(generations as any) as any)
  return { ctx }
}

describe('real SkillRegistry integration', () => {
  it('scope_reaches_provider_get_through_real_registry_and_scopeless_get_has_no_notice', async () => {
    const { ctx } = await harness()
    const scope = {}
    createScope(ctx, scope)
    const scoped = await ctx.skills.get('opsx-test', { scope, cwd: '/w' })
    expect(scoped?.content).toContain('notice.available=1.13.3')
    const scopeless = await ctx.skills.get('opsx-test', { cwd: '/w' })
    expect(scopeless?.content).not.toContain('notice.available')
  })
  it('tool_gesture_and_command_consumers_each_spend_notice_and_listing_never_does', async () => {
    let checks = 0
    const { ctx } = await harness(async () => { checks++; return { installed: '1.13.2', available: '1.13.3', managementEntry: 'dsh-openspec-manage' } })
    const scope = {}
    createScope(ctx, scope)
    await ctx.skills.list({ scope })
    expect(checks).toBe(0)
    const first = await ctx.skills.get('opsx-test', { scope })
    const second = await ctx.skills.get('opsx-test', { scope })
    expect(first?.content).toContain('notice.available=1.13.3')
    expect(second?.content).not.toContain('notice.available')
  })
})
