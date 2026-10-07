import { describe, expect, it, vi } from 'vitest'
import { createManagementGuidance, type ManagementActions } from '../src/manage-flow.js'
import { createManagementController } from '../src/manage-controller.js'
import { createOpenSpecSkillProvider } from '../src/provider.js'
import { parseManageInput } from '../src/manage-input.js'

describe('management flow', () => {
  it('loading_manage_help_mutates_nothing', async () => {
    const mutate = vi.fn()
    const guidance = createManagementGuidance()
    const provider = createOpenSpecSkillProvider({ skills: [{ name: 'openspec-upgrade', body: guidance }], generationId: 'g1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'disabled', check: async () => { mutate() } })
    const loaded = await provider.get({ name: 'openspec-upgrade' })
    expect(loaded?.content).toContain('openspec update')
    expect(loaded?.content).toContain('opsx-update')
    expect(loaded?.content).toContain('openspec-upgrade')
    expect(mutate).not.toHaveBeenCalled()
  })
  it('guidance_states_the_exact_grammar_the_parser_accepts_so_a_model_cannot_invent_a_command', () => {
    const guidance = createManagementGuidance()
    // Every example the guidance shows must parse to the intent it claims; nothing shown may be `invalid`.
    const shown = [...guidance.matchAll(/`\/openspec-upgrade([^`]*)`/g)].map(match => match[1]!.trim())
    expect(shown.length).toBeGreaterThanOrEqual(3)
    for (const raw of shown) expect(parseManageInput(raw.replace(/<X\.Y\.Z>/g, '1.14.1')).kind, raw).not.toBe('invalid')
    expect(shown).toEqual(expect.arrayContaining(['upgrade <X.Y.Z> --approve', 'rollback <X.Y.Z> --approve', 'refresh-project --approve']))
    // The verb is required, and the literal flag is the only consent: say both explicitly.
    expect(guidance).toMatch(/verb[^.]*required|always (start|begin) with/i)
    expect(guidance).toContain('--approve')
    expect(parseManageInput('1.14.1').kind).toBe('invalid')
  })
  it('upgrade_changes_only_runtime_selection', async () => {
    const actions: ManagementActions = { transact: vi.fn(async (target: string) => ({ status: 'ok' as const, target, activation: 'live' as const })), refreshProject: vi.fn() }
    const controller = createManagementController(actions)
    expect(await controller.upgrade('1.13.3', { approved: true })).toMatchObject({ status: 'ok', target: '1.13.3', activation: 'live' })
    expect(actions.transact).toHaveBeenCalledWith('1.13.3', { approved: true })
    expect(actions.refreshProject).not.toHaveBeenCalled()
  })
})
