import { describe, expect, it, vi } from 'vitest'
import { createManagementGuidance, type ManagementActions } from '../src/manage-flow.js'
import { createManagementController } from '../src/manage-controller.js'
import { createOpenSpecSkillProvider } from '../src/provider.js'

describe('management flow', () => {
  it('loading_manage_help_mutates_nothing', async () => {
    const mutate = vi.fn()
    const guidance = createManagementGuidance()
    const provider = createOpenSpecSkillProvider({ skills: [{ name: 'dsh-openspec-manage', body: guidance }], generationId: 'g1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'disabled', check: async () => { mutate() } })
    const loaded = await provider.get({ name: 'dsh-openspec-manage' })
    expect(loaded?.content).toContain('openspec update')
    expect(loaded?.content).toContain('opsx-update')
    expect(loaded?.content).toContain('dsh-openspec-manage')
    expect(mutate).not.toHaveBeenCalled()
  })
  it('upgrade_changes_only_runtime_selection', async () => {
    const actions: ManagementActions = { transact: vi.fn(async (target: string) => ({ status: 'ok' as const, target, activation: 'live' as const })), refreshProject: vi.fn() }
    const controller = createManagementController(actions)
    expect(await controller.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok', target: '1.13.3', activation: 'live' })
    expect(actions.transact).toHaveBeenCalledWith('1.13.3', { approved: true })
    expect(actions.refreshProject).not.toHaveBeenCalled()
  })
})
