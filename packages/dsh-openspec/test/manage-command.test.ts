import { describe, expect, it, vi } from 'vitest'
import { parseManageInput } from '../src/manage-input.js'
import { registerWorkflowCommands } from '../src/commands.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"
function harness(prepareManagement: any) {
  const handlers = new Map<string, (invocation: any) => Promise<any>>()
  const ctx = { commands: { register: (definition: any) => { handlers.set(definition.name, definition.handler); return () => {} } } }
  registerWorkflowCommands(ctx as any, { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'i', manageInstruction: 'guide', prepareManagement } as any)
  const sent: string[] = []
  const agent = { session: { header: { cwd: '/caller' } }, send: async (message: any) => { sent.push(message.content[0].text) } }
  return { run: (rawInput: string) => handlers.get('openspec-upgrade')!({ agent, rawInput }), sent }
}

describe('management command', () => {
  it('parses_only_exact_stable_targets_and_the_literal_approval_flag', () => {
    expect(parseManageInput('')).toEqual({ kind: 'help' })
    expect(parseManageInput('upgrade 1.13.3')).toEqual({ kind: 'upgrade', target: '1.13.3', approved: false })
    expect(parseManageInput('upgrade 1.13.3 --approve')).toEqual({ kind: 'upgrade', target: '1.13.3', approved: true })
    expect(parseManageInput('refresh-project --approve')).toEqual({ kind: 'refresh-project', approved: true })
    for (const bad of ['upgrade latest', 'upgrade 1.13.3-beta.1 --approve', 'upgrade 1.13.3 extra', 'rm -rf', 'upgrade']) expect(parseManageInput(bad)).toEqual({ kind: 'invalid' })
  })
  it('help_and_unapproved_requests_never_prepare_a_mutation_command', async () => {
    const prepare = vi.fn()
    const h = harness(prepare)
    await h.run(''); await h.run('upgrade 1.13.3')
    expect(prepare).not.toHaveBeenCalled()
    expect(h.sent.at(-1)).toContain('explicit-approval-required')
  })
  // Previous assertions required Host controller execution; D3 forbids that path. Real helper transaction assertions remain in session-updater/upgrade-transaction suites.
  it('approved_upgrade_and_project_refresh_only_prepare_separate_session_commands', async () => {
    const prepare = vi.fn(async () => ({ status: 'ready', command: "'/usr/bin/node' '/updater'", workdir: '/caller' }))
    const h = harness(prepare)
    await h.run('upgrade 1.13.3 --approve')
    expect(prepare).toHaveBeenCalledWith({ kind: 'upgrade', target: '1.13.3', approved: true }, '/caller')
    expect(h.sent.at(-1)).toContain('Bash')
    expect(h.sent.at(-1)).toContain('has not executed it')
    await h.run('refresh-project --approve')
    expect(prepare).toHaveBeenLastCalledWith({ kind: 'refresh-project', approved: true }, '/caller')
  })
  it('invalid_input_and_absent_transaction_support_never_mutate', async () => {
    const h = harness(undefined)
    expect(await h.run('upgrade latest --approve')).toMatchObject({ kind: 'error' })
    await h.run('upgrade 1.13.3 --approve')
    expect(h.sent.at(-1)).toContain('transaction-support-unavailable')
  })
})
