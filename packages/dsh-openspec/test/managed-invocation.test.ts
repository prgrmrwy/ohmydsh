import { describe, expect, it } from 'vitest'
import { managedInvocation } from '../src/managed-invocation.js'

describe('managed OpenSpec invocation', () => {
  it('body_then_one_block_with_pinned_version_and_telemetry_and_update_check_off', () => {
    const invocation = managedInvocation({ node: '/usr/bin/node', cli: '/dsh/plugins/dsh-openspec/generations/1.13.2/bin/openspec.js', telemetry: 'adapter-off' })
    expect(invocation).toContain('OPENSPEC_NO_UPDATE_CHECK=1')
    expect(invocation).toContain('OPENSPEC_TELEMETRY=0')
    expect(invocation).toContain("'/dsh/plugins/dsh-openspec/generations/1.13.2/bin/openspec.js'")
  })
  it('official_cli_makes_zero_registry_requests_and_telemetry_official_omits_assignment', () => {
    const invocation = managedInvocation({ node: '/usr/bin/node', cli: '/dsh/gen/bin/openspec.js', telemetry: 'official' })
    expect(invocation).toContain('OPENSPEC_NO_UPDATE_CHECK=1')
    expect(invocation).not.toContain('OPENSPEC_TELEMETRY=0')
  })
})
