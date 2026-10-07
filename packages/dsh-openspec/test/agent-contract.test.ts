import { describe, expect, it } from 'vitest'
import { registerWorkflowCommands } from '../src/commands.js'
import { strictAgent } from './support-agent.js'

const invocation = "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'"
function harness(extra: Record<string, unknown> = {}) {
  const defs = new Map<string, any>()
  registerWorkflowCommands({ commands: { register: (d: any) => { defs.set(d.name, d); return () => {} } } } as any, {
    entries: [{ workflowId: 'propose', skillName: 'openspec-propose', commandName: 'opsx-propose', body: 'official body' }],
    generation: 'g1', invocation, telemetry: 'adapter-off', updateCheck: 'disabled', initInstruction: 'init', manageInstruction: 'guide', ...extra,
  } as any)
  return defs
}

describe('commands honour the real Agent.send contract', () => {
  it.each([['openspec-upgrade', ''], ['openspec-init', ''], ['opsx-propose', 'add auth']])('%s delivers a valid, waking message the agent will actually answer', async (name, rawInput) => {
    const { agent, delivered } = strictAgent('/workspace/a')
    const result = await harness({ hasOpenSpecDir: async () => false }).get(name).handler({ agent, rawInput })
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'success' })
    expect(delivered.length).toBeGreaterThan(0)
    // The adapter-authored message is a plugin message, never a made-up kind.
    expect(delivered[0]!.message.source).toEqual({ kind: 'plugin', plugin: 'dsh-openspec' })
    // At least one delivery must wake the driver, otherwise the user sees nothing happen.
    expect(delivered.some(item => item.wakeup)).toBe(true)
  })
  it('opsx_command_sends_user_arguments_as_a_valid_user_message_after_the_adapter_message', async () => {
    const { agent, delivered } = strictAgent('/workspace/a')
    await harness().get('opsx-propose').handler({ agent, rawInput: 'add auth' })
    expect(delivered.map(item => item.message.source.kind)).toEqual(['plugin', 'user'])
    expect(delivered[1]!.message.content[0].text).toBe('add auth')
    expect(delivered[0]!.message.content[0].text).not.toContain('add auth')
  })
})
