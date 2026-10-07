import { describe, expect, it, vi } from 'vitest'
import { createOpenSpecSkillProvider } from '../src/provider.js'

describe('provider scope forwarding', () => {
  it('scope_reaches_provider_get_at_model_and_gesture_call_sites_and_undefined_agent_gets_no_notice', async () => {
    const scope = {}; const check = vi.fn(async () => ({ installed: '1.13.2', available: '1.13.3', managementEntry: 'dsh-openspec-manage' }))
    const provider = createOpenSpecSkillProvider({ skills: [{ name: 's', body: 'b' }], generationId: 'g1', invocation: "env OPENSPEC_NO_UPDATE_CHECK=1 OPENSPEC_TELEMETRY=0 '/usr/bin/node' '/cli'", telemetry: 'adapter-off', updateCheck: 'enabled', check, isScopeLive: candidate => candidate === scope })
    await provider.get({ name: 's' }, { scope })
    await provider.get({ name: 's' })
    expect(check).toHaveBeenCalledTimes(1)
  })
})
