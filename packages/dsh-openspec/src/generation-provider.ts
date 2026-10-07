import { loadGeneration, recoverGeneration } from './generations.js'
import { renderConsumedContent } from './adapter-block.js'

type Notice = { installed?: string; available?: string; managementEntry?: string } | void
export function createGenerationBackedProvider(options: { home: string; telemetry: 'adapter-off' | 'official'; updateCheck: 'enabled' | 'disabled'; check?: (scope?: object) => Promise<Notice>; isScopeLive?: (scope: object) => boolean; onGeneration?: (id: string) => void }) {
  const inFlight = new WeakMap<object, Promise<Notice>>()
  const spent = new WeakMap<object, string>()
  const live = (scope: object) => options.isScopeLive?.(scope) ?? true
  let lastGeneration: string | undefined
  return {
    async list() {
      const generation = await loadGeneration(options.home)
      if (lastGeneration !== generation.id) { lastGeneration = generation.id; options.onGeneration?.(generation.id) }
      return (Array.isArray(generation.skills) ? generation.skills : []).filter((skill: any) => generation.delivery !== 'commands' || skill.name === 'openspec-upgrade').map((skill: any) => ({ name: skill.name, description: skill.description ?? `Official OpenSpec workflow ${skill.name}` }))
    },
    async get(candidate: { name?: string }, lookup: { cwd?: string; scope?: object } = {}) {
      const scope = lookup.scope
      let checkResult: Notice = undefined
      if (scope && live(scope) && options.updateCheck === 'enabled' && options.check) {
        let flight = inFlight.get(scope)
        if (!flight) { flight = Promise.resolve().then(() => options.check!(scope)); inFlight.set(scope, flight) }
        try { checkResult = await flight } catch { checkResult = undefined }
      }
      const generation = await loadGeneration(options.home, undefined, { verifyRuntime: true })
      if (lastGeneration !== generation.id) { lastGeneration = generation.id; options.onGeneration?.(generation.id) }
      const skill = (Array.isArray(generation.skills) ? generation.skills : []).find((item: any) => item.name === candidate.name)
      if (!skill || typeof skill.body !== 'string' || typeof generation.invocation !== 'string') return undefined
      let notice: Notice = undefined
      if (scope && live(scope) && checkResult?.installed && checkResult.available && checkResult.managementEntry) {
        const pair = `${checkResult.installed}:${checkResult.available}`
        if (spent.get(scope) !== pair) { spent.set(scope, pair); notice = checkResult }
      }
      if (scope && inFlight.has(scope)) inFlight.delete(scope)
      const validNotice = notice?.installed && notice.available && notice.managementEntry ? { installed: notice.installed, available: notice.available, managementEntry: notice.managementEntry } : undefined
      let recovery: 'none' | 'recovery-required' = 'none'
      try { recovery = (await recoverGeneration(options.home)).state === 'recovery-required' ? 'recovery-required' : 'none' }
      catch { recovery = 'recovery-required' }
      return { content: renderConsumedContent(skill.body, { generation: generation.id, invocation: generation.invocation, telemetry: options.telemetry, updateCheck: options.updateCheck, notice: validNotice, recovery }) }
    },
  }
}
