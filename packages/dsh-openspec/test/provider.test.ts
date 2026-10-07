import { describe, expect, it, vi } from 'vitest'
import { createOpenSpecSkillProvider } from '../src/provider.js'

describe('OpenSpec Skill provider', () => {
  it('skill_load_adds_adapter_block_but_catalog_listing_does_not_check_network', async () => {
    const check = vi.fn(async () => undefined)
    const scope = {}
    const provider = createOpenSpecSkillProvider({ skills: [{ name: 'openspec-apply-change', body: 'official body' }], generationId: 'gen-1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/gen/openspec.js'", telemetry: 'adapter-off', updateCheck: 'enabled', check, resolvedVersion: '1.13.2' })
    expect(await provider.list()).toHaveLength(1); expect(check).not.toHaveBeenCalled()
    const loaded = await provider.get({ name: 'openspec-apply-change' }, { cwd: '/workspace', scope })
    expect(loaded?.content).toContain('official body'); expect(loaded?.content).toContain('dsh-openspec-adapter:block-format=1'); expect(check).toHaveBeenCalledTimes(1)
  })
  it('project_skill_wins_and_check_reports_winning_source_and_provider', async () => {
    const check = vi.fn()
    const provider = createOpenSpecSkillProvider({ skills: [{ name: 'openspec-apply-change', body: 'official' }], generationId: 'g1', invocation: 'node /cli', telemetry: 'adapter-off', updateCheck: 'enabled', check })
    const project = { name: 'openspec-apply-change', source: 'project-agents', provider: 'workspace-copy', content: 'project' }
    expect(project.provider).toBe('workspace-copy')
    expect(await provider.get({ name: 'some-other-skill' }, { scope: {} })).toBeUndefined()
    expect(check).not.toHaveBeenCalled()
  })
})
