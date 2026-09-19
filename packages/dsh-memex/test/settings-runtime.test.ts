import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerMemexSettings } from '../src/scope/settings.js'

const contexts: Context[] = []

afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

describe('memex settings with the real provider', () => {
  it('fails registration for an invalid initial section', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memex-settings-'))
    const path = join(dir, 'settings.yaml')
    writeFileSync(path, 'dsh-memex:\n  scopes:\n    - name: duplicate\n    - name: duplicate\n')
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(FileSettingsProvider, { path, watch: false })
    expect(() => registerMemexSettings(ctx)).toThrow(/duplicate scope/)
  })

  it('uses schema defaults when the section is absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memex-settings-'))
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(FileSettingsProvider, { path: join(dir, 'settings.yaml'), watch: false })
    expect(registerMemexSettings(ctx).get()).toEqual({ autoDerive: true, scopes: [], bindings: [] })
  })
})
