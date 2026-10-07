import { describe, expect, it, vi } from 'vitest'
import { dispatchWorkflowCommand } from '../src/commands.js'

describe('workflow command carrier', () => {
  it('command_adapter_message_has_body_then_block_without_raw_argument_and_a_separate_user_message_carries_it', async () => {
    const send = vi.fn()
    await dispatchWorkflowCommand({ name: 'opsx-propose', body: 'official body', generation: 'gen-1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'enabled', args: 'secret arg', send })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ source: 'dsh-openspec', text: expect.stringContaining('official body') })
    expect(send.mock.calls[0]?.[0].text).not.toContain('secret arg')
    expect(send.mock.calls[1]?.[0]).toEqual({ source: 'user', text: 'secret arg' })
  })
})
