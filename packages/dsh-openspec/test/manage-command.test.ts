import { describe, expect, it, vi } from 'vitest'
import { parseManageInput } from '../src/manage-input.js'
import { registerWorkflowCommands } from '../src/commands.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"
function harness(management: any) {
  const handlers = new Map<string, (invocation: any) => Promise<any>>()
  const ctx = { commands: { register: (definition: any) => { handlers.set(definition.name, definition.handler); return () => {} } } }
  registerWorkflowCommands(ctx as any, { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'i', manageInstruction: 'guide', management } as any)
  const sent: string[] = []
  const agent = { send: async (message: any) => { sent.push(message.content[0].text) } }
  return { run: (rawInput: string) => handlers.get('dsh-openspec-manage')!({ agent, rawInput }), sent }
}

describe('management command', () => {
  it('parses_only_exact_stable_targets_and_the_literal_approval_flag', () => {
    expect(parseManageInput('')).toEqual({ kind: 'help' })
    expect(parseManageInput('upgrade 1.13.3')).toEqual({ kind: 'upgrade', target: '1.13.3', approved: false })
    expect(parseManageInput('upgrade 1.13.3 --approve')).toEqual({ kind: 'upgrade', target: '1.13.3', approved: true })
    expect(parseManageInput('refresh-project --approve')).toEqual({ kind: 'refresh-project', approved: true })
    for (const bad of ['upgrade latest', 'upgrade 1.13.3-beta.1 --approve', 'upgrade 1.13.3 extra', 'rm -rf', 'upgrade']) expect(parseManageInput(bad)).toEqual({ kind: 'invalid' })
  })
  it('help_and_unapproved_requests_never_reach_the_transaction_with_consent', async () => {
    const management = { upgrade: vi.fn(async (_t: string, consent: any) => ({ status: consent.approved ? 'ok' : 'blocked', reason: 'explicit-approval-required' })), rollback: vi.fn(), refreshProject: vi.fn() }
    const h = harness(management)
    await h.run('')
    expect(management.upgrade).not.toHaveBeenCalled()
    await h.run('upgrade 1.13.3')
    expect(management.upgrade).toHaveBeenCalledWith('1.13.3', { approved: false })
    expect(h.sent.at(-1)).toContain('explicit-approval-required')
    expect(management.refreshProject).not.toHaveBeenCalled()
  })
  it('approved_upgrade_runs_only_the_transaction_and_project_refresh_stays_separate', async () => {
    const management = { upgrade: vi.fn(async (target: string) => ({ status: 'ok', target, activation: 'pending-reload' })), rollback: vi.fn(), refreshProject: vi.fn(async () => ({ status: 'ok' })) }
    const h = harness(management)
    await h.run('upgrade 1.13.3 --approve')
    expect(management.upgrade).toHaveBeenCalledWith('1.13.3', { approved: true })
    expect(management.refreshProject).not.toHaveBeenCalled()
    expect(h.sent.at(-1)).toContain('pending-reload')
    await h.run('refresh-project --approve')
    expect(management.refreshProject).toHaveBeenCalledWith({ approved: true })
  })
  it('invalid_input_and_absent_transaction_support_never_mutate', async () => {
    const h = harness(undefined)
    expect(await h.run('upgrade latest --approve')).toMatchObject({ kind: 'error' })
    await h.run('upgrade 1.13.3 --approve')
    expect(h.sent.at(-1)).toContain('transaction-support-unavailable')
  })
})
