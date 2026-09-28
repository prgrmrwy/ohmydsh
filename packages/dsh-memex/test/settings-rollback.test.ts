import { describe, expect, it } from 'vitest'
import { MemexSettingsSchema } from '../src/scope/settings.js'
import { MemexSettingsSchema020 } from './fixtures/settings-schema-0.2.0.js'

describe('rolling back to 0.2.0', () => {
  it('the frozen 0.2.0 schema passes workspaces through unchanged and the new schema recovers it', () => {
    const scopes = [{ name: 'proj', pathPrefixes: ['~/w/proj'], memory: false }]
    const workspaces = [{ path: '~/w/proj', memory: false as const }, { path: '~/w/other', fallback: false as const }]
    const section = { autoDerive: true, scopes, bindings: [], workspaces }

    const old = MemexSettingsSchema020(section) as Record<string, unknown>
    // 0.2.0 does not know the key, but its non-strict object keeps it: a save
    // made under 0.2.0 writes the declarations back rather than dropping them.
    expect(old.workspaces).toEqual(workspaces)
    expect(old.scopes).toEqual([{ ...scopes[0], remotePatterns: [], publish: 'external' }])

    const recovered = MemexSettingsSchema(old)
    expect(recovered.workspaces).toEqual(workspaces)
    expect(recovered.scopes).toEqual(old.scopes)
  })
})
