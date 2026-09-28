// Frozen verbatim from dsh-memex 0.2.0 (`src/scope/settings.ts` at 6064bea).
// Do not edit: it stands in for the plugin a user rolls back to, and the
// rollback test proves that version keeps a newer section's `workspaces`.
import Schema from '@deepseek-ai/schemastery'

const scopeName = Schema.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).required()
const optionalString = Schema.string()
const stringList = () => Schema.array(Schema.string()).default([])

export const MemexSettingsSchema020 = Schema.object({
  autoDerive: Schema.boolean().default(true),
  scopes: Schema.array(Schema.object({
    name: scopeName,
    primary: Schema.boolean(),
    home: optionalString,
    pathPrefixes: stringList(),
    remotePatterns: stringList(),
    publish: Schema.union(['internal', 'external'] as const).default('external'),
    fallback: Schema.boolean(),
    memory: Schema.boolean(),
  })).default([]),
  bindings: Schema.array(Schema.object({
    name: Schema.string().required(),
    read: stringList(),
    write: stringList(),
  })).default([]),
})
