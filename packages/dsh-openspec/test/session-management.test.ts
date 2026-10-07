import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Commands from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import { registerWorkflowCommands } from '../src/commands.js'
import { strictAgent } from './support-agent.js'
import { checkTool } from '../../worktree-session/src/host/guard.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"
function harness(cwd: string | undefined) {
  const definitions = new Map<string, any>()
  const mutations = { upgrade: vi.fn(), rollback: vi.fn(), refreshProject: vi.fn() }
  const prepareManagement = vi.fn(async () => ({ status: 'ready', command: "'/usr/bin/node' '/updater.js' upgrade 1.13.3 --approve", workdir: cwd }))
  registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
    { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', management: mutations, prepareManagement } as any)
  const { agent, texts } = strictAgent(cwd)
  return { mutations, prepareManagement, get sent() { return texts() }, run: (rawInput: string) => definitions.get('openspec-upgrade').handler({ agent, rawInput }) }
}

describe('management session execution boundary', () => {
  it('every_published_command_advertises_an_input_hint_because_both_custom_commands_accept_arguments', () => {
    const definitions = new Map<string, any>()
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [{ workflowId: 'propose', skillName: 'openspec-propose', commandName: 'opsx-propose', body: 'b' }], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'i', manageInstruction: 'g' })
    // Commands that parse arguments must say so: the client uses the descriptor to offer the textbox, and
    // without it picking the command from the menu leaves the composer empty.
    for (const name of ['opsx-propose', 'openspec-init', 'openspec-upgrade']) {
      expect(definitions.get(name)?.input?.hint, name).toEqual(expect.any(String))
      expect(definitions.get(name).input.hint.length).toBeGreaterThan(0)
    }
    expect(definitions.get('openspec-init').input.hint).toContain('--tools')
    expect(definitions.get('openspec-upgrade').input.hint).toContain('--approve')
    // The advertised grammar must be the one the parsers actually accept (no drift between hint and parser).
    expect(definitions.get('openspec-upgrade').input.hint).toMatch(/upgrade .*rollback .*refresh-project/s)
  })
  it('actual_init_slash_validates_raw_options_before_any_send_and_uses_current_managed_invocation', async () => {
    const definitions = new Map<string, any>(), hasOpenSpecDir = vi.fn(async () => false)
    const current = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/current/node' '/current/cli'"
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', hasOpenSpecDir,
        initToolIds: async () => (await import('../src/upstream-compat.js')).getOfficialInitToolIds(),
        generationState: async () => ({ id: 'g2', invocation: current }) })
    const handler = definitions.get('openspec-init').handler, { agent, delivered, texts } = strictAgent('/caller/project-b')
    for (const [rawInput, argument] of [['--tools evil;touch', 'tools'], ['--language en;rm', 'language'], ['--profile unknown', 'profile'], ['--force', 'option'], ['--tools claude --tools codex', 'tools']] as const) {
      expect(await handler({ agent, rawInput })).toMatchObject({ kind: 'error', text: expect.stringContaining(argument) })
      expect(delivered).toHaveLength(0); expect(hasOpenSpecDir).not.toHaveBeenCalled()
    }
    expect(await handler({ agent, rawInput: '--tools amazon-q --profile custom --language zh-CN' })).toMatchObject({ kind: 'success' })
    const text = texts()[0]!
    expect(delivered.every(item => item.wakeup)).toBe(true)
    expect(text).toContain(`${current} init '/caller/project-b' --tools amazon-q --profile custom --no-copilot-cloud --no-animation --language zh-CN`)
    expect(text).toContain('generation=g2'); expect(text).not.toContain('$DSH_OPENSPEC_CLI')
  })
  it('real_command_service_preserves_session_header_cwd_and_does_not_record_approval_arguments', async () => {
    const ctx = new Context(); await ctx.plugin(Commands)
    const prepare = vi.fn(async (_intent: unknown, cwd: string) => ({ status: 'ready' as const, command: '/fixture/updater', workdir: cwd }))
    const dispose = registerWorkflowCommands(ctx, { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', prepareManagement: prepare })
    const events: any[] = []
    const { agent, texts } = strictAgent('/fixture/workspace-b')
    ;(agent.session as any).append = (type: string, data: unknown) => { events.push({ type, data }); return events.length }
    createScope(ctx, agent)
    try {
      const result = await ctx.commands.execute(agent as any, '/openspec-upgrade refresh-project --approve', [], new AbortController().signal)
      expect(result?.result.kind).toBe('success')
      expect(prepare).toHaveBeenCalledWith({ kind: 'refresh-project', approved: true }, '/fixture/workspace-b')
      expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
      expect(events[0].data).not.toHaveProperty('args')
      expect(texts()[0]).toContain('/fixture/workspace-b')
    } finally { dispose() }
  })
  it('init_uses_durable_session_cwd_and_never_host_fallback_or_undocumented_agent_field', async () => {
    const definitions = new Map<string, any>(), hasOpenSpecDir = vi.fn(async () => false)
    registerWorkflowCommands({ commands: { register: (d: any) => { definitions.set(d.name, d); return () => {} } } } as any,
      { entries: [], generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', hasOpenSpecDir })
    const first = strictAgent('/caller/project-b', { cwd: '/wrong-shadow' })
    expect(await definitions.get('openspec-init').handler({ agent: first.agent, rawInput: '' })).toMatchObject({ kind: 'success' })
    expect(hasOpenSpecDir).toHaveBeenCalledWith('/caller/project-b')
    expect(first.texts()[0]).toContain("'/caller/project-b'")
    hasOpenSpecDir.mockClear()
    const second = strictAgent(undefined, { cwd: '/wrong-shadow' })
    expect(await definitions.get('openspec-init').handler({ agent: second.agent, rawInput: '' })).toMatchObject({ kind: 'error' })
    expect(hasOpenSpecDir).not.toHaveBeenCalled(); expect(second.delivered).toHaveLength(0)
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
