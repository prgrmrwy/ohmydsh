import { buildAdapterBlock, renderConsumedContent, type AdapterBlockFields } from './adapter-block.js'

export type OpenSpecSkill = { name: string; body: string; description?: string }
export type ProviderOptions = {
  skills: OpenSpecSkill[]
  generationId: string
  invocation: string
  telemetry: 'adapter-off' | 'official'
  updateCheck: 'enabled' | 'disabled'
  check?: () => Promise<{ installed?: string; available?: string; managementEntry?: string } | void>
  recovery?: 'none' | 'recovery-required'
  isScopeLive?: (scope: object) => boolean
  resolvedVersion?: string
}
export function createOpenSpecSkillProvider(options: ProviderOptions) {
  const oncePerScope = new WeakMap<object, { installed: string; available: string; checking: boolean }>()
  const blockFields = (): AdapterBlockFields => ({
    generation: options.generationId,
    invocation: options.invocation,
    telemetry: options.telemetry,
    updateCheck: options.updateCheck,
    recovery: options.recovery,
  })
  return {
    async list() {
      return options.skills.map(({ name, description }) => ({ name, description: description ?? `Official OpenSpec workflow ${name}` }))
    },
    async get(candidate: { name?: string }, lookupOptions: { scope?: object } = {}) {
      const skill = options.skills.find((item) => item.name === candidate.name)
      if (!skill) return undefined
      let notice
      const scope = lookupOptions.scope
      const liveScope = scope && (options.isScopeLive?.(scope) ?? true)
      const previouslyShown = liveScope ? oncePerScope.get(scope) : undefined
      if (options.updateCheck === 'enabled' && options.check && liveScope && !previouslyShown?.checking) {
        // Reserve synchronously before awaiting so concurrent tool/gesture loads
        // in the same live scope cannot both deliver the same pair.
        oncePerScope.set(scope, { installed: previouslyShown?.installed ?? '', available: 'reserved', checking: true })
        try {
          const result = await options.check()
          if (result?.installed && result.available && result.managementEntry && result.installed !== result.available) {
            if (previouslyShown?.installed !== result.installed || previouslyShown?.available !== result.available) {
              if (options.isScopeLive?.(scope) ?? true) {
                notice = result
                oncePerScope.set(scope, { installed: result.installed, available: result.available, checking: false })
              }
            }
          }
        } catch { /* update checks never block a Skill load */ }
        finally {
          if ((options.isScopeLive?.(scope) ?? true) && oncePerScope.get(scope)?.checking) {
            oncePerScope.set(scope, { installed: previouslyShown?.installed ?? '', available: previouslyShown?.available ?? '', checking: false })
          }
        }
      }
      const fields = blockFields()
      if (notice?.installed && notice.available && notice.managementEntry) fields.notice = {
        installed: notice.installed,
        available: notice.available,
        managementEntry: notice.managementEntry,
      }
      return { content: renderConsumedContent(skill.body, fields) }
    },
  }
}

export function adapterBlockFor(fields: AdapterBlockFields): string { return buildAdapterBlock(fields) }
