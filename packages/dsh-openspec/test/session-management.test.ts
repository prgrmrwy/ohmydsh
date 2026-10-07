import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import { registerWorkflowCommands } from '../src/commands.js'
import { checkTool } from '../../worktree-session/src/host/guard.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"
function harness(cwd: string | undefined) {
  const definitions = new Map<string, any>()
  const mutations = { upgrade: vi.fn(), rollback: vi.fn(), refreshProject: vi.fn() }
  const prepareManagement = vi.fn(async () => ({ status: 'ready', command: "'/usr/bin/node' '/updater.js' upgrade 1.13.3 --approve", workdir: cwd }))
  registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
    { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', management: mutations, prepareManagement } as any)
  const sent: string[] = []
  return { mutations, prepareManagement, sent, run: (rawInput: string) => definitions.get('openspec-upgrade').handler({ agent: { session: { header: { cwd } }, send: async (m: any) => sent.push(m.content[0].text) }, rawInput }) }
}

describe('management session execution boundary', () => {
  it('real_command_service_preserves_session_header_cwd_and_does_not_record_approval_arguments', async () => {
    const ctx = new Context(); await ctx.plugin(Commands)
    const prepare = vi.fn(async (_intent: unknown, cwd: string) => ({ status: 'ready' as const, command: '/fixture/updater', workdir: cwd }))
    const dispose = registerWorkflowCommands(ctx, { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', prepareManagement: prepare })
    const events: any[] = [], send = vi.fn()
    const agent = { session: { header: { cwd: '/fixture/workspace-b' }, append: (type: string, data: unknown) => { events.push({ type, data }); return events.length } }, send }
    createScope(ctx, agent)
    try {
      const result = await ctx.commands.execute(agent as any, '/openspec-upgrade refresh-project --approve', [], new AbortController().signal)
      expect(result?.result.kind).toBe('success')
      expect(prepare).toHaveBeenCalledWith({ kind: 'refresh-project', approved: true }, '/fixture/workspace-b')
      expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
      expect(events[0].data).not.toHaveProperty('args')
      expect(send.mock.calls[0]![0].content[0].text).toContain('/fixture/workspace-b')
    } finally { dispose() }
  })
  it('init_uses_durable_session_cwd_and_never_host_fallback_or_undocumented_agent_field', async () => {
    const definitions = new Map<string, any>(), hasOpenSpecDir = vi.fn(async () => false)
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', hasOpenSpecDir })
    const send = vi.fn()
    expect(await definitions.get('openspec-init').handler({ agent: { cwd: '/wrong-shadow', session: { header: { cwd: '/caller/project-b' } }, send }, rawInput: '' })).toMatchObject({ kind: 'success' })
    expect(hasOpenSpecDir).toHaveBeenCalledWith('/caller/project-b')
    expect(send.mock.calls[0]![0].content[0].text).toContain("'/caller/project-b'")
    hasOpenSpecDir.mockClear(); send.mockClear()
    expect(await definitions.get('openspec-init').handler({ agent: { cwd: '/wrong-shadow', session: { header: {} }, send }, rawInput: '' })).toMatchObject({ kind: 'error' })
    expect(hasOpenSpecDir).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled()
  })
  it('existing_worktree_bash_guard_denies_running_the_updater_in_authoritative_checkout', () => {
    const operation = { operationId: 'task', worktreePath: '/repo/.worktrees/task', binding: { mode: 'source-session', state: 'bound' } } as any
    expect(checkTool({ name: 'bash', args: { command: "'/node' '/updater' upgrade 1.13.3 --approve", workdir: '/repo' } }, operation)).toContain('超出托管执行目录')
    expect(checkTool({ name: 'bash', args: { command: "'/node' '/updater' upgrade 1.13.3 --approve", workdir: '/repo/.worktrees/task' } }, operation)).toBeUndefined()
    // In-root Bash is governed by normal file policy; the updater independently refuses a .git-file caller.
  })
  it('approved_slash_never_invokes_host_mutations_and_only_supplies_a_session_bash_plan', async () => {
    for (const raw of ['upgrade 1.13.3 --approve', 'rollback 1.13.3 --approve', 'refresh-project --approve']) {
      const h = harness('/caller/project')
      await h.run(raw)
      for (const mutate of Object.values(h.mutations)) expect(mutate).not.toHaveBeenCalled()
      expect(h.prepareManagement).toHaveBeenCalledWith(expect.objectContaining({ approved: true }), '/caller/project')
      expect(h.sent.join('\n')).toContain('Bash')
      expect(h.sent.join('\n')).toContain('/caller/project')
      expect(h.sent.join('\n')).toContain('/updater.js')
    }
  })
  it('unapproved_request_and_missing_caller_cwd_never_offer_or_execute_a_mutation_command', async () => {
    for (const [cwd, raw] of [['/caller/project', 'upgrade 1.13.3'], [undefined, 'upgrade 1.13.3 --approve']] as const) {
      const h = harness(cwd)
      await h.run(raw)
      for (const mutate of Object.values(h.mutations)) expect(mutate).not.toHaveBeenCalled()
      expect(h.prepareManagement).not.toHaveBeenCalled()
      expect(h.sent.join('\n')).not.toContain('/updater.js')
      expect(h.sent.join('\n')).toMatch(/approval-required|caller-cwd-unavailable/)
    }
  })
})
