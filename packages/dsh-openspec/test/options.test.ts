import { describe, expect, it } from 'vitest'
import { OptionsSchema, readOptions } from '../src/options.js'

describe('OpenSpec adapter options (DSH 0.2 plugin Config)', () => {
  it('options_read_from_plugin_config_with_documented_defaults', () => {
    // Values come from the adapter's own Cordis Config row, never from a settings registry.
    expect(readOptions({ updateCheck: 'disabled', telemetry: 'official' })).toEqual({ updateCheck: 'disabled', telemetry: 'official' })
    expect(readOptions({})).toEqual({ updateCheck: 'enabled', telemetry: 'adapter-off' })
    expect(readOptions(undefined)).toEqual({ updateCheck: 'enabled', telemetry: 'adapter-off' })
  })
  it('schema_applies_defaults_and_rejects_values_outside_the_documented_enums', () => {
    expect(OptionsSchema({})).toMatchObject({ updateCheck: 'enabled', telemetry: 'adapter-off' })
    expect(OptionsSchema({ updateCheck: 'disabled', telemetry: 'official' })).toMatchObject({ updateCheck: 'disabled', telemetry: 'official' })
    expect(() => OptionsSchema({ updateCheck: 'sometimes' } as never)).toThrow()
    expect(() => OptionsSchema({ telemetry: 'on' } as never)).toThrow()
  })
  it('option_fields_are_not_volatile_so_a_change_remounts_the_plugin', () => {
    // A volatile field is committed live without remounting, which would leave an invocation and
    // generation identity computed from the old telemetry value. The spec requires a remount instead.
    const dict = (OptionsSchema as unknown as { dict: Record<string, { meta?: { volatile?: boolean } }> }).dict
    for (const key of ['updateCheck', 'telemetry']) {
      expect(dict[key], key).toBeDefined()
      expect(dict[key]!.meta?.volatile, key).not.toBe(true)
    }
  })
})
