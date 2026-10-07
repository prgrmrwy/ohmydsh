import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createRegistryProvider } from '../src/registry-provider.js'

describe('Pet exposure gap', () => {
  it('host_level_provider_is_visible_in_pet_style_scope_and_gap_is_documented', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const policy = { modelInvocable: true, userInvocable: true }
    const control = { list: async () => [{ name: 'control-skill', description: 'c' }], get: async () => undefined }
    ctx.skills.registerProvider(() => ({ name: 'control', list: async () => [{ name: 'control-skill', description: 'c', invocation: policy, source: 'bundled', provider: 'control', rank: 700, locator: 'c' }], get: async () => undefined }) as any)
    ctx.skills.registerProvider(() => createRegistryProvider({ list: async () => [{ name: 'opsx-test', description: 'd' }], get: async () => undefined }) as any)
    void control
    const petScope = {}
    createScope(ctx, petScope)
    const names = (await ctx.skills.list({ scope: petScope })).map(item => item.name)
    // The control row must list, otherwise the harness no longer exercises the real registry (vacuous pass).
    expect(names).toContain('control-skill')
    expect(names).toContain('opsx-test')
    const backlog = readFileSync(fileURLToPath(new URL('../../../BACKLOG.md', import.meta.url)), 'utf8')
    expect(backlog).toMatch(/D006/)
    expect(readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')).toMatch(/Known scope gap/)
  })
})
