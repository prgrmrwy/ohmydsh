import { describe, expect, it } from 'vitest'
import { getOptions } from '../src/options.js'

describe('OpenSpec adapter settings', () => {
  it('options_read_from_settings_namespace_with_documented_defaults', () => {
    const registered: string[] = []
    const ctx = {
      settings: {
        register(name: string, schema: unknown, config: unknown) {
          registered.push(name)
          return { get: () => ({ updateCheck: 'disabled', telemetry: 'official' }), schema, config }
        },
      },
    }
    expect(getOptions(ctx as never)).toEqual({ updateCheck: 'disabled', telemetry: 'official' })
    expect(registered).toEqual(['dsh-openspec'])

    const defaults = getOptions({ settings: { register: () => ({ get: () => ({}) }) } } as never)
    expect(defaults).toEqual({ updateCheck: 'enabled', telemetry: 'adapter-off' })
  })
})
