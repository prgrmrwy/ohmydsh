import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-skill'
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem'
import { createScope } from '@deepseek-ai/dsh-scope'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

it('bundle provider loads one real registry skill and disposes it', async () => {
  const ctx = new Context()
  const registry = await ctx.plugin(Registry)
  const patch = readFileSync(resolve(import.meta.dirname, '../cordis.patch.yml'), 'utf8')
  expect(patch).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
  expect(patch).toContain('providerName: auto-model-routing-plugin')
  expect(patch).toContain('includeDefaultRoots: false')
  const require = createRequire(resolve(import.meta.dirname, '../package.json'))
  const bundledSkillDir = resolve(require.resolve('dsh-auto-model-routing/package.json'), '..', 'skills')
  const mounted = await ctx.plugin(Filesystem, { providerName: 'auto-model-routing-plugin', includeDefaultRoots: false, bundledSkillDir, watch: false })
  try {
    const list = await ctx.skills.list()
    expect(list.map(s => s.name).sort()).toEqual(['auto-model-routing-report', 'subagent-model-routing'])
    expect((await ctx.skills.get('subagent-model-routing'))?.content).toContain('reasoning_effort')
    const scope = {}
    createScope(ctx, scope)
    expect((await ctx.skills.list({ scope })).map(s => s.name)).toContain('subagent-model-routing')
    await mounted.dispose()
    expect(await ctx.skills.list()).toEqual([])
  } finally { await mounted.dispose(); await registry.dispose() }
})
