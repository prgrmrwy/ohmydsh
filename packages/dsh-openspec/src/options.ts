import Schema from '@deepseek-ai/schemastery'

export type DshOpenSpecOptions = {
  updateCheck: 'enabled' | 'disabled'
  telemetry: 'adapter-off' | 'official'
}

/**
 * The two user options, as fields of the adapter's own Cordis plugin Config.
 *
 * DSH 0.2 removed the Host settings registry (`ctx.settings.register`) and `settings.yaml`:
 * configuration belongs to the plugin row and is persisted in the profile patch. The fields are
 * deliberately NOT `.volatile()`. The managed invocation (which carries the telemetry choice) is
 * recorded inside immutable generations whose identity is a hash; a live, non-remounting edit
 * would leave those computed from the old value. A plain field makes any change remount the
 * plugin, so everything is recomputed from one consistent value.
 */
export const OptionsSchema = Schema.object({
  updateCheck: Schema.union(['enabled', 'disabled'] as const).default('enabled')
    .description('Check the official npm registry for a newer stable OpenSpec release when an adapter Skill or command is consumed. `disabled` makes zero network requests.'),
  telemetry: Schema.union(['adapter-off', 'official'] as const).default('adapter-off')
    .description('`adapter-off` sets OPENSPEC_TELEMETRY=0 on the managed CLI; `official` leaves the official CLI telemetry setting to the user.'),
})

/** Normalize the mounted Config into the two options, applying the documented defaults. */
export function readOptions(config: Partial<DshOpenSpecOptions> | undefined): DshOpenSpecOptions {
  return {
    updateCheck: config?.updateCheck === 'disabled' ? 'disabled' : 'enabled',
    telemetry: config?.telemetry === 'official' ? 'official' : 'adapter-off',
  }
}
