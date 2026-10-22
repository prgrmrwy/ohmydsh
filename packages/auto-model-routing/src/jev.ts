import { createHash } from 'node:crypto'
import { tiers, type Tier } from './effort.js'
import rubric from './rubric.json' with { type: 'json' }

export type JevCategory =
  | 'missing-credential' | 'insufficient-credits' | 'unauthorized' | 'rate-limited'
  | 'region-blocked' | 'rejected' | 'unavailable' | 'timeout' | 'invalid-response'
export type Distribution = Partial<Record<Tier, number>>
export type JevResult = { kind: 'ok'; tier: Tier; confidence?: number; probabilities?: Distribution; ms: number } | { kind: 'failed'; category: JevCategory } | { kind: 'cancelled' }
export interface CredentialSource { get(name: string): { value: string } | undefined }

/** Human-readable hint per category, shown on the chip, panel and tool errors. */
export const CATEGORY_HINTS: Readonly<Record<JevCategory, string>> = {
  'missing-credential': '未配置 OPENROUTER_API_KEY',
  'insufficient-credits': '余额不足，请充值',
  unauthorized: 'key 无效或无权限',
  'rate-limited': '请求被限流',
  'region-blocked': '地区受限',
  rejected: '请求被拒绝',
  unavailable: 'Jev 服务不可用',
  timeout: 'Jev 响应超时',
  'invalid-response': 'Jev 响应无效',
}

const MODEL = 'typesafe/jev-1.13'
const MAX_BODY = 64 * 1024
/** Shared by the main session and `route_subagent`; only `state` differs (design D4). Single source: rubric.json. */
export const TIER_QUESTIONS = rubric
/** Content hash of the rubric, stored with each judgement so labels can be compared per rubric. */
export const rubricVersion = createHash('sha256').update(JSON.stringify(TIER_QUESTIONS)).digest('hex').slice(0, 8)
/** One tier up (`escalated` stays): the only tier arithmetic in code; it never reads message text. */
export function tierAbove(tier: Tier): Tier { return tiers[Math.min(tiers.indexOf(tier) + 1, tiers.length - 1)]! }

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
  constructor(private readonly env: CredentialSource, base = 'https://openrouter.ai', private readonly timeoutMs = 3000) {
    this.url = `${base}/api/alpha/decisions`
  }

  /** One request, no retry. Never throws; never returns the body or the key. */
  /** `state` is assembled and redacted by the caller (`buildState`). */
  async judge(state: string, signal: AbortSignal): Promise<JevResult> {
    const key = this.env.get('OPENROUTER_API_KEY')?.value
    if (!key) return { kind: 'failed', category: 'missing-credential' }
    const deadline = AbortSignal.timeout(this.timeoutMs)
    const started = performance.now()
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([signal, deadline]),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'ohmydsh auto-model-routing' },
        body: JSON.stringify({ model: MODEL, state, questions: TIER_QUESTIONS }),
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
      let body: { error?: { code?: unknown }; answers?: { tier?: { choice?: unknown; confidence?: unknown; probabilities?: unknown } } }
      try { body = JSON.parse(raw) } catch { return { kind: 'failed', category: 'invalid-response' } }
      if (typeof body?.error?.code === 'number') return { kind: 'failed', category: byStatus(body.error.code) }
      const choice = body?.answers?.tier?.choice
      if (!tiers.includes(choice as Tier)) return { kind: 'failed', category: 'invalid-response' }
      const confidence = body.answers?.tier?.confidence
      const spread = body.answers?.tier?.probabilities as Record<string, unknown> | undefined
      // Keep only the four tiers' values in [0, 1]; anything else in the reply is ignored.
      const unit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1
      const probabilities: Distribution = {}
      for (const t of tiers) { const v = spread?.[t]; if (unit(v)) probabilities[t] = v }
      const ms = Math.round(performance.now() - started)
      return {
        kind: 'ok', tier: choice as Tier, ms,
        ...(unit(confidence) ? { confidence } : {}),
        ...(Object.keys(probabilities).length ? { probabilities } : {}),
      }
    } catch (error) {
      if (signal.aborted) return { kind: 'cancelled' }
      if (deadline.aborted) return { kind: 'failed', category: 'timeout' }
      // undici reports `redirect: 'error'` as a TypeError whose cause reads "unexpected redirect".
      const refusedRedirect = (error as { cause?: { message?: unknown } })?.cause?.message === 'unexpected redirect'
      return { kind: 'failed', category: refusedRedirect ? 'rejected' : 'unavailable' }
    }
  }
}
