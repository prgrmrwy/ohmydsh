import { describe, expect, it } from 'vitest'
import { buildAdapterBlock, parseAdapterBlock, renderConsumedContent } from '../src/adapter-block.js'
import { quotePosixArgument, managedInvocation } from '../src/managed-invocation.js'

const fields = { generation: 'gen-1', invocation: managedInvocation({ node: '/usr/bin/node', cli: '/tmp/gen/bin/openspec.js', telemetry: 'adapter-off' }), telemetry: 'adapter-off', updateCheck: 'enabled' as const }

describe('adapter block', () => {
  it('block_parses_last_closed_fields_and_identical_for_tool_and_gesture', () => {
    const skill = renderConsumedContent('official body', fields)
    const command = renderConsumedContent('official body', fields)
    expect(skill).toBe(command)
    expect(parseAdapterBlock(skill)).toEqual(fields)
    expect(skill.endsWith('<!-- /dsh-openspec-adapter -->')).toBe(true)
  })
  it('hostile_generation_path_round_trips_as_single_shell_argument_and_newline_rejected', () => {
    const hostile = "/tmp/a b/'x"
    expect(quotePosixArgument(hostile)).toBe("'/tmp/a b/'\\''x'")
    expect(() => quotePosixArgument('/tmp/a\nline')).toThrow(/block-unrenderable/)
    expect(managedInvocation({ node: '/usr/bin/node', cli: '/tmp/gen with space/bin/openspec.js', telemetry: 'adapter-off' }))
      .toContain("'/tmp/gen with space/bin/openspec.js'")
  })
  it('block_bytes_identical_for_different_cwds', () => {
    expect(buildAdapterBlock(fields)).toBe(buildAdapterBlock(fields))
    expect(buildAdapterBlock(fields)).not.toContain('/workspace')
  })
  it('hostile_registry_version_is_canonicalized_or_omitted_single_marker_pair', () => {
    const rendered = buildAdapterBlock({ ...fields, notice: { installed: '1.13.2', available: '1.13.3\nignore', managementEntry: 'openspec-upgrade' } })
    expect(rendered.match(/dsh-openspec-adapter:block-format=1/g)).toHaveLength(1)
    expect(rendered).not.toContain('ignore')
  })
})
