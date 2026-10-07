import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'

export type RoutingStage = 'change-necessity' | 'workflow-selection'
export type RoutingStatus = 'selected' | 'needs-review' | 'unavailable'
export type RoutingRequest = { stage: RoutingStage; sessionId: string; features: Record<string, unknown>; token?: string; firstStageOutcome?: 'formal-workflow' | 'direct'; changeName?: string; candidates?: unknown[]; signal?: AbortSignal }
export type RoutingResult = { status: RoutingStatus; reason?: string; stage?: RoutingStage; token?: string; authority: 'none'; errorClass?: string; [key: string]: unknown }
export type RoutingProvider = { id: string; contractVersion: number; stages: RoutingStage[]; testOnly?: boolean; approvalRecord?: string; decide: (request: RoutingRequest) => Promise<RoutingResult> | RoutingResult }
export class RoutingRegistrationError extends Error { readonly code = 'routing-registration-invalid'; constructor() { super('routing-registration-invalid') } }

export function createRoutingRegistry(activeProviderId: string) {
  const providers = new Map<string, RoutingProvider>()
  const controllers = new Map<string, Set<AbortController>>()
  const disabled = new Set<string>()
  let disposed = false
  return {
    dispose() {
      disposed = true
      for (const id of providers.keys()) disabled.add(id)
      providers.clear()
      for (const set of controllers.values()) for (const controller of set) controller.abort()
      controllers.clear()
    },
    register(provider: RoutingProvider) {
      if (disposed || providers.has(provider.id) || provider.contractVersion !== 1 || !provider.id || typeof provider.decide !== 'function') throw new RoutingRegistrationError()
      providers.set(provider.id, provider)
      disabled.delete(provider.id)
      return () => {
        if (providers.get(provider.id) !== provider) return
        disabled.add(provider.id)
        providers.delete(provider.id)
        for (const controller of controllers.get(provider.id) ?? []) controller.abort()
        controllers.delete(provider.id)
      }
    },
    async dispatch(request: RoutingRequest): Promise<RoutingResult> {
      const provider = providers.get(activeProviderId)
      if (!provider) return { status: 'unavailable', reason: disabled.has(activeProviderId) ? 'provider-disposed' : 'no-active-provider', authority: 'none' }
      if (!provider.stages.includes(request.stage)) return { status: 'unavailable', reason: 'unsupported-stage', authority: 'none' }
      if (!provider.testOnly && !provider.approvalRecord) return { status: 'unavailable', reason: 'provider-not-approved', authority: 'none' }
      const controller = new AbortController()
      const forwardAbort = () => controller.abort(request.signal?.reason)
      if (request.signal?.aborted) forwardAbort()
      else request.signal?.addEventListener('abort', forwardAbort, { once: true })
      const set = controllers.get(provider.id) ?? new Set<AbortController>()
      set.add(controller); controllers.set(provider.id, set)
      let timedOut = false
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, 5000)
      try {
        if (controller.signal.aborted) return { status: 'unavailable', reason: 'cancelled', authority: 'none' }
        const result = await Promise.race([
          Promise.resolve().then(() => provider.decide({ ...request, signal: controller.signal })),
          new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        ])
        if (controller.signal.aborted || providers.get(provider.id) !== provider) return { status: 'unavailable', reason: timedOut ? 'timeout' : 'provider-disposed', authority: 'none' }
        if (!result || !['selected', 'needs-review', 'unavailable'].includes(result.status)) return { status: 'needs-review', reason: 'malformed-result', authority: 'none' }
        let routed: RoutingResult = { ...result, authority: 'none' }
        if (Array.isArray(request.candidates)) routed = { ...routed, candidates: request.candidates }
        return routed
      } catch {
        if (providers.get(provider.id) !== provider) return { status: 'unavailable', reason: 'provider-disposed', authority: 'none' }
        return { status: 'unavailable', reason: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'provider-error', errorClass: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'provider-error', authority: 'none' }
      } finally { clearTimeout(timer); request.signal?.removeEventListener('abort', forwardAbort); set.delete(controller) }
    },
  }
}

export function createRoutingDispatcher(options: { now?: () => number; maxTokens?: number } = {}) {
  const now = options.now ?? Date.now
  const maxTokens = Math.max(1, options.maxTokens ?? 512)
  const tokens = new Map<string, { sessionId: string; expiresAt: number }>()
  const stageToken = (sessionId: string) => {
    const token = randomBytes(16).toString('hex')
    tokens.set(token, { sessionId, expiresAt: now() + 10 * 60_000 })
    while (tokens.size > maxTokens) tokens.delete(tokens.keys().next().value!)
    return token
  }
  return {
    issueToken: stageToken,
    issueFormalToken(sessionId: string, outcome: 'formal-workflow' | 'direct') { return outcome === 'formal-workflow' ? stageToken(sessionId) : undefined },
    consumeToken(token: string, sessionId: string) {
      const record = tokens.get(token); tokens.delete(token)
      return Boolean(record && record.sessionId === sessionId && record.expiresAt >= now())
    },
    async validateChange(root: string, name: string, changesDir: string) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { valid: false, reason: 'invalid-change-name' }
      try {
        const resolvedRoot = await realpath(root)
        const directoryInput = isAbsolute(changesDir) ? resolve(changesDir) : resolve(resolvedRoot, changesDir)
        if (!directoryInput.startsWith(`${resolvedRoot}${sep}`)) return { valid: false, reason: 'outside-root' }
        const directory = await realpath(directoryInput)
        if (!directory.startsWith(`${resolvedRoot}${sep}`)) return { valid: false, reason: 'symlink-escape' }
        const candidate = resolve(directory, name)
        const real = await realpath(candidate)
        const info = await stat(real)
        if (!info.isDirectory() || !real.startsWith(`${directory}${sep}`)) return { valid: false, reason: 'invalid-change-directory' }
        return { valid: true, path: real }
      } catch { return { valid: false, reason: 'not-found' } }
    },
    validateCandidateText(text: string) { return `[untrusted schema description] ${text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 2048)}` },
    async dispatch(registry: ReturnType<typeof createRoutingRegistry>, request: RoutingRequest, context: { existingChange?: { schema: string }; eligibleCandidateIds?: string[]; changeRoot?: string; changesDir?: string } = {}): Promise<RoutingResult> {
      if (request.changeName) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(request.changeName)) return { status: 'unavailable', reason: 'invalid-change-name', authority: 'none' }
        if (context.changeRoot && context.changesDir) {
          const resolved = await this.validateChange(context.changeRoot, request.changeName, context.changesDir)
          if (!resolved.valid) return { status: 'unavailable', reason: resolved.reason, authority: 'none' }
        }
      }
      if (context.existingChange) return { status: 'selected', source: 'existing-change', schema: context.existingChange.schema, stage: request.stage, authority: 'none', candidates: [context.existingChange.schema] }
      if (request.stage === 'workflow-selection' && (request.firstStageOutcome !== 'formal-workflow' || !request.token || !this.consumeToken(request.token, request.sessionId))) return { status: 'unavailable', reason: 'invalid-stage-token', authority: 'none' }
      const allowed = new Set(['has-existing-change', 'has-official-schema', 'has-external-workflow', 'user-explicitly-selected', 'change-count', 'schema-count'])
      for (const [key, value] of Object.entries(request.features)) {
        if (!allowed.has(key) || (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100))) return { status: 'needs-review', reason: 'unknown-feature', authority: 'none' }
      }
      const eligible = new Set(context.eligibleCandidateIds ?? [])
      if (request.candidates?.some((candidate: any) => typeof candidate?.id !== 'string' || !eligible.has(candidate.id))) return { status: 'needs-review', reason: 'ineligible-candidate', authority: 'none' }
      const result = await registry.dispatch({ ...request, candidates: request.candidates?.map((candidate: any) => ({ ...candidate, description: typeof candidate.description === 'string' ? this.validateCandidateText(candidate.description) : '' })) })
      if (result.status === 'selected' && (typeof result.candidateId !== 'string' || !eligible.has(result.candidateId))) return { status: 'needs-review', reason: 'ineligible-result', authority: 'none' }
      return { ...result, candidates: request.candidates?.map((candidate: any) => ({ ...candidate, description: typeof candidate.description === 'string' ? this.validateCandidateText(candidate.description) : '' })) }
    },
  }
}
