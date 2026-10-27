import { resolveDecisionService, type DecisionConfig } from './decision-service.js'
export interface PolicyMeasure { ms: number; decisionProvider: string; decisionModel: string; confidence?: number; probabilities?: Record<string, number>; capabilityConfidence?: number; capabilityProbabilities?: Record<string, number> }
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const distribution = (value: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(value ?? {}).filter(([,v]) => probability(v))) as Record<string, number>
import policyQuestions from './rubric.json' with { type: 'json' }
export type Depth = 'lower' | 'baseline' | 'higher'
export type Capability = 'bounded' | 'analytical' | 'frontier'
export type PolicyResult = ({ kind: 'ok'; depth: Depth; capability?: Capability | 'insufficient_context' } & PolicyMeasure) | { kind: 'failed'; category: JevCategory } | { kind: 'cancelled' }
import type { JevCategory } from './hints.js'
export { CATEGORY_HINTS, type JevCategory } from './hints.js'
export interface CredentialSource { get(name: string): { value: string } | undefined | Promise<{ value: string } | undefined> }

const MAX_BODY = 64 * 1024
/** The only rule file: main and child questions are taken from it verbatim. */
export const QUESTIONS = policyQuestions

function byStatus(status: number): JevCategory {
  if (status === 402) return 'insufficient-credits'
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate-limited'
  if (status === 451) return 'region-blocked'
  if (status >= 500) return 'unavailable'
  return 'rejected'
}

export class JevClient {
  readonly url: string
  constructor(private readonly env: CredentialSource, base = 'https://openrouter.ai', private readonly timeoutMs: number | (() => number) = 3000, private readonly service?: () => DecisionConfig | undefined) {
    this.url = `${base}/api/alpha/decisions`
  }

  /** One request, no retry. Never throws; never returns the body or the key. `state` comes from `buildState`. */
  async judgePolicy(state: string, signal: AbortSignal, scope: 'main' | 'child', dimensions: 'both' | 'capability' | 'depth' = 'both'): Promise<PolicyResult> {
    const questions = scope === 'main' || dimensions === 'depth' ? { depth: policyQuestions.depth }
      : dimensions === 'capability' ? { capability: policyQuestions.capability } : policyQuestions
    const result = await this.decide(state, signal, questions)
    if (result.kind !== 'ok') return result
    const depth = result.answers?.depth?.choice
    const capability = result.answers?.capability?.choice
    if (Object.hasOwn(questions, 'depth') && (typeof depth !== 'string' || !Object.hasOwn(policyQuestions.depth.criteria, depth))) return { kind: 'failed', category: 'invalid-response' }
    if (Object.hasOwn(questions, 'capability') && (typeof capability !== 'string' || !Object.hasOwn(policyQuestions.capability.criteria, capability))) return { kind: 'failed', category: 'invalid-response' }
    return { kind: 'ok', depth: (Object.hasOwn(questions, 'depth') ? depth : 'baseline') as Depth, ...(Object.hasOwn(questions, 'capability') ? { capability: capability as Capability | 'insufficient_context' } : {}), ms: result.ms, decisionProvider: result.decisionProvider, decisionModel: result.decisionModel,
      ...(probability(result.answers.depth?.confidence) ? { confidence: result.answers.depth.confidence } : {}),
      ...(result.answers.depth?.probabilities ? { probabilities: distribution(result.answers.depth.probabilities) } : {}),
      ...(probability(result.answers.capability?.confidence) ? { capabilityConfidence: result.answers.capability.confidence } : {}),
      ...(result.answers.capability?.probabilities ? { capabilityProbabilities: distribution(result.answers.capability.probabilities) } : {}) }
  }

  private async decide(state: string, signal: AbortSignal, questions: unknown): Promise<{ kind: 'ok'; answers: Record<string, { choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> }>; ms: number; decisionProvider: string; decisionModel: string } | { kind: 'failed'; category: JevCategory } | { kind: 'cancelled' }> {
    if (signal.aborted) return { kind: 'cancelled' }
    const configuredTimeout = typeof this.timeoutMs === 'function' ? this.timeoutMs() : this.timeoutMs
    // Settings callbacks use the public range; numeric constructor overrides remain available to tests.
    const timeout = typeof this.timeoutMs === 'function' && (!Number.isInteger(configuredTimeout) || configuredTimeout < 1000 || configuredTimeout > 4500) ? 3000 : configuredTimeout
    const deadline = AbortSignal.timeout(timeout)
    const started = performance.now()
    try {
      const service = resolveDecisionService(this.service?.())
      const abort = AbortSignal.any([signal, deadline])
      let onAbort: () => void = () => {}
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('aborted'))
        abort.addEventListener('abort', onAbort, { once: true })
      })
      let credential: { value: string } | undefined
      try { credential = await Promise.race([Promise.resolve(this.env.get(service.credential)), cancelled]) }
      finally { abort.removeEventListener('abort', onAbort) }
      const key = credential?.value
      if (signal.aborted) return { kind: 'cancelled' }
      if (deadline.aborted) return { kind: 'failed', category: 'timeout' }
      if (!key) return { kind: 'failed', category: 'missing-credential' }
      const response = await fetch(this.service ? service.endpoint : this.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, deadline]),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ohmydsh auto-model-routing' },
        body: JSON.stringify({ model: service.model, state, questions }),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return { kind: 'failed', category: byStatus(response.status) }
      }
      if (!response.body) return { kind: 'failed', category: 'invalid-response' }
      const reader = response.body.getReader()
      const bytes = new Uint8Array(MAX_BODY)
      let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          if (size + chunk.value.byteLength > MAX_BODY) {
            await reader.cancel().catch(() => {})
            return { kind: 'failed', category: 'invalid-response' }
          }
          bytes.set(chunk.value, size)
          size += chunk.value.byteLength
        }
      } finally { reader.releaseLock() }
      const raw = new TextDecoder().decode(bytes.subarray(0, size))
      let body: { error?: { code?: unknown }; answers?: Record<string, { choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> }> }
      try { body = JSON.parse(raw) } catch { return { kind: 'failed', category: 'invalid-response' } }
      if (typeof body?.error?.code === 'number') return { kind: 'failed', category: byStatus(body.error.code) }
      if (!body?.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return { kind: 'failed', category: 'invalid-response' }
      return { kind: 'ok', answers: body.answers, ms: Math.round(performance.now() - started), decisionProvider: service.provider, decisionModel: service.model }
    } catch (error) {
      if (signal.aborted) return { kind: 'cancelled' }
      if (deadline.aborted) return { kind: 'failed', category: 'timeout' }
      // undici reports `redirect: 'error'` as a TypeError whose cause reads "unexpected redirect".
      const refusedRedirect = (error as { cause?: { message?: unknown } })?.cause?.message === 'unexpected redirect'
      return { kind: 'failed', category: refusedRedirect ? 'rejected' : 'unavailable' }
    }
  }
}
