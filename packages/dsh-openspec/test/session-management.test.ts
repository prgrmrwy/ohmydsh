import { describe, expect, it, vi } from 'vitest'
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
  return { mutations, prepareManagement, sent, run: (rawInput: string) => definitions.get('openspec-upgrade').handler({ agent: { cwd, send: async (m: any) => sent.push(m.content[0].text) }, rawInput }) }
}

describe('management session execution boundary', () => {
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
