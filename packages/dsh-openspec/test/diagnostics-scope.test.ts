import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { diagnoseSkillWinners } from '../src/manage-check.js'
import { registerWorkflowCommands } from '../src/commands.js'
import { createRegistryProvider } from '../src/registry-provider.js'

const policy = { modelInvocable: true, userInvocable: true }
const summary = (provider: string, source: string, rank: number) => ({ name: 'openspec-apply-change', description: 'd', invocation: policy, source, provider, rank, locator: provider })

async function registryWithWorkspaceOverride() {
  const ctx = new Context(); await ctx.plugin(SkillRegistry)
  ctx.skills.registerProvider(() => createRegistryProvider({ list: async () => [{ name: 'openspec-apply-change', description: 'managed' }], get: async () => undefined }) as any)
  // A project copy that exists ONLY under /workspace-with-copy. The registry sorts by ascending rank, so a lower rank outranks the bundled adapter (700).
  ctx.skills.registerProvider(() => ({ name: 'workspace-copy', list: async (o: { cwd?: string }) => o.cwd === '/workspace-with-copy' ? [summary('workspace-copy', 'project-agents', 100)] : [], get: async () => undefined }) as any)
  return ctx
}

describe('caller-scoped winning-provider diagnostics', () => {
  it('real_registry_winner_depends_on_the_calling_workspace_so_diagnostics_must_pass_it', async () => {
    const ctx = await registryWithWorkspaceOverride()
    const scope = {}; createScope(ctx, scope)
    const withCopy = await diagnoseSkillWinners(ctx.skills, ['openspec-apply-change'], { cwd: '/workspace-with-copy', scope })
    const withoutCopy = await diagnoseSkillWinners(ctx.skills, ['openspec-apply-change'], { cwd: '/plain-workspace', scope })
    expect(withCopy).toEqual([{ name: 'openspec-apply-change', source: 'project-agents', provider: 'workspace-copy' }])
    expect(withoutCopy).toEqual([{ name: 'openspec-apply-change', source: 'bundled', provider: 'dsh-openspec' }])
  })
  it('management_handler_passes_the_session_header_cwd_and_agent_to_the_winner_lookup', async () => {
    const definitions = new Map<string, any>(), skillDiagnostics = vi.fn(async () => [])
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'i', manageInstruction: 'guide', skillDiagnostics })
    const agent = { session: { header: { cwd: '/workspace-with-copy' } }, send: vi.fn() }
    await definitions.get('openspec-upgrade').handler({ agent, rawInput: '' })
    expect(skillDiagnostics).toHaveBeenCalledWith({ cwd: '/workspace-with-copy', scope: agent })
  })
  it('node_support_is_probed_from_the_session_bash_path_not_the_host_process', async () => {
    const definitions = new Map<string, any>(), send = vi.fn(), checkBashNodeVersion = vi.fn(async () => '18.0.0')
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'i', manageInstruction: 'guide', checkBashNodeVersion })
    await definitions.get('openspec-upgrade').handler({ agent: { session: { header: { cwd: '/w' } }, send }, rawInput: '' })
    const text = send.mock.calls[0]![0].content[0].text as string
    expect(checkBashNodeVersion).toHaveBeenCalled()
    expect(text).toContain('"nodeSupported":false')            // 18.0.0 < required 20.19.0, even though the Host runs a newer Node
    expect(text).toContain('"bashNodeVersion":"18.0.0"')
  })
})
