import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'

export type DshOpenSpecOptions = {
  updateCheck: 'enabled' | 'disabled'
  telemetry: 'adapter-off' | 'official'
}

export const DshOpenSpecSettingsSchema = Schema.object({
  updateCheck: Schema.union(['enabled', 'disabled'] as const).default('enabled'),
  telemetry: Schema.union(['adapter-off', 'official'] as const).default('adapter-off'),
})

export function registerDshOpenSpecSettings(ctx: Context): SettingsScope<DshOpenSpecOptions> {
  return ctx.settings.register('dsh-openspec', DshOpenSpecSettingsSchema, { applies: 'live' }) as SettingsScope<DshOpenSpecOptions>
}

export function getOptions(ctx: Context): DshOpenSpecOptions {
  const settings = registerDshOpenSpecSettings(ctx)
  const value = settings.get() as Partial<DshOpenSpecOptions>
  return {
    updateCheck: value.updateCheck === 'disabled' ? 'disabled' : 'enabled',
    telemetry: value.telemetry === 'official' ? 'official' : 'adapter-off',
  }
}
