import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export type RoutingStage = 'change-necessity' | 'workflow-selection'
export type RoutingStatus = 'selected' | 'needs-review' | 'unavailable'
export type RoutingRequest = { stage: RoutingStage; sessionId: string; features: Record<string, unknown>; token?: string; firstStageOutcome?: 'formal-workflow' | 'direct'; changeName?: string; candidates?: unknown[]; signal?: AbortSignal }
export type RoutingResult = { status: RoutingStatus; reason?: string; stage?: RoutingStage; token?: string; authority: 'none'; errorClass?: string; [key: string]: unknown }
export type RoutingProvider = { id: string; contractVersion: number; stages: RoutingStage[]; testOnly?: boolean; approvalRecord?: string; decide: (request: RoutingRequest) => Promise<RoutingResult> | RoutingResult }
export class RoutingRegistrationError extends Error { readonly code = 'routing-registration-invalid'; constructor() { super('routing-registration-invalid') } }

/** Recorded schema of an existing change via the pinned official metadata reader; undefined when none is recorded or readable. */
async function readRecordedSchema(changeDir: string, root: string): Promise<string | undefined> {
  try {
    const entry = createRequire(import.meta.url).resolve('@fission-ai/openspec')
    const reader = await import(pathToFileURL(join(dirname(dirname(entry)), 'dist/utils/change-metadata.js')).href)
    const metadata = reader.readChangeMetadata(changeDir, root)
    return typeof metadata?.schema === 'string' ? metadata.schema : undefined
  } catch { return undefined }
}

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
        if ('confidence' in result && !(typeof result.confidence === 'number' && Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1)) return { status: 'needs-review', reason: 'malformed-result', authority: 'none' }
        return { ...result, authority: 'none' }
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
      const record = tokens.get(token)
      if (!record) return false
      // Expired tokens are purged; a different session's attempt must NOT burn the owner's token.
      if (record.expiresAt < now()) { tokens.delete(token); return false }
      if (record.sessionId !== sessionId) return false
      tokens.delete(token)
      return true
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
    validateCandidateText(text: string) {
      const label = '[untrusted schema description] '
      let body = text.replace(/[\u0000-\u001f\u007f]/g, '')
      // Bound the whole string in UTF-8 bytes (not UTF-16 units) so multibyte text cannot exceed 2 KiB.
      while (Buffer.byteLength(label + body) > 2048) body = body.slice(0, -1)
      return label + body
    },
    async dispatch(registry: ReturnType<typeof createRoutingRegistry>, request: RoutingRequest, context: { existingChange?: { schema: string } | undefined; eligibleCandidateIds?: string[]; changeRoot?: string; changesDir?: string; readRecordedSchema?: (changeDir: string, root: string) => Promise<string | undefined> } = {}): Promise<RoutingResult> {
      if (request.changeName) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(request.changeName)) return { status: 'unavailable', reason: 'invalid-change-name', authority: 'none' }
        if (context.changeRoot && context.changesDir) {
          const resolved = await this.validateChange(context.changeRoot, request.changeName, context.changesDir)
          if (!resolved.valid) return { status: 'unavailable', reason: resolved.reason, authority: 'none' }
          // Authority comes from the change's own recorded metadata, read by the pinned official reader.
          // A caller-supplied schema is never trusted when a root is available.
          const recorded = await (context.readRecordedSchema ?? readRecordedSchema)(resolved.path!, context.changeRoot)
          if (recorded) return { status: 'selected', source: 'existing-change', schema: recorded, stage: request.stage, authority: 'none', candidates: [recorded] }
          context = { ...context, existingChange: undefined }
        }
      }
      if (context.existingChange) return { status: 'selected', source: 'existing-change', schema: context.existingChange.schema, stage: request.stage, authority: 'none', candidates: [context.existingChange.schema] }
      if (request.stage === 'workflow-selection' && (request.firstStageOutcome !== 'formal-workflow' || !request.token || !this.consumeToken(request.token, request.sessionId))) return { status: 'unavailable', reason: 'invalid-stage-token', authority: 'none' }
      const allowed = new Set(['has-existing-change', 'has-official-schema', 'has-external-workflow', 'user-explicitly-selected', 'change-count', 'schema-count'])
      for (const [key, value] of Object.entries(request.features)) {
        if (!allowed.has(key) || (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100))) return { status: 'needs-review', reason: 'unknown-feature', authority: 'none' }
      }
      if ((request.candidates?.length ?? 0) > 32) return { status: 'needs-review', reason: 'too-many-candidates', authority: 'none' }
      const eligible = new Set(context.eligibleCandidateIds ?? [])
      if (request.candidates?.some((candidate: any) => typeof candidate?.id !== 'string' || !eligible.has(candidate.id))) return { status: 'needs-review', reason: 'ineligible-candidate', authority: 'none' }
      const bounded = request.candidates?.map((candidate: any) => ({ ...candidate, description: typeof candidate.description === 'string' ? this.validateCandidateText(candidate.description) : '' }))
      const result = await registry.dispatch({ ...request, candidates: bounded })
      if (result.status === 'selected') {
        // First-stage vocabulary is fixed by the contract; second-stage ids must be eligible typed candidates.
        const firstStageIds = request.stage === 'change-necessity' && !request.candidates?.length ? ['direct', 'formal-workflow'] : []
        if (typeof result.candidateId !== 'string' || !(eligible.has(result.candidateId) || firstStageIds.includes(result.candidateId))) return { status: 'needs-review', reason: 'ineligible-result', authority: 'none' }
      }
      // Never forward a provider-supplied token: only the dispatcher mints them, only for a formal first-stage result.
      const { token: _providerToken, ...clean } = result as RoutingResult
      const routed: RoutingResult = { ...clean, ...(bounded ? { candidates: bounded } : {}) }
      if (request.stage === 'change-necessity' && result.status === 'selected') {
        const token = this.issueFormalToken(request.sessionId, result.candidateId === 'formal-workflow' ? 'formal-workflow' : 'direct')
        if (token) routed.token = token
      }
      return routed
    },
  }
}
