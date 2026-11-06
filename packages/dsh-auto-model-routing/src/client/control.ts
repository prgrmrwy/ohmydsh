import { t } from './locales.js'
import { resolvePreset } from '../presets/index.js'
import { localized } from './strategy-details.js'
export interface Rpc { call(channel: string, endpoint: string, payload: unknown): Promise<{ok: boolean; value?: unknown; error?: {message?: string}}> }
export async function callRouting(rpc: Rpc, sessionId: string, mode?: 'AUTO' | 'MANUAL'): Promise<unknown> {
  const result = await rpc.call('/api', `auto-model-routing.${mode ? 'setMode' : 'state'}`, { sessionId, ...(mode ? { mode } : {}) })
  if (!result.ok) throw new Error(result.error?.message ?? t('routingFailed'))
  return result.value
}
export const chipOrder = -10
/** Panel visibility: entering or focusing the chip (or its panel) opens it; leaving or blurring closes it. */
export type PanelEvent = 'enter' | 'focus' | 'leave' | 'blur'
export const panelOpenAfter = (event: PanelEvent): boolean => event === 'enter' || event === 'focus'

/** Latest Jev decision as returned by the state endpoint when the hint switch is on. */
export interface Decision { id: number; source: 'main' | 'subagent'; tier?: string; effort: string; model?: string; confidence?: number; probabilities?: Record<string, number>; ms: number; depth: string; capability?: string; capabilityConfidence?: number; capabilityProbabilities?: Record<string, number>; preset?: string; decisionProvider?: string; decisionModel?: string; provider?: string; status?: string }
export interface Toast { id: number; lines: string[] }
const pct = (v: number) => `${Math.round(v * 100)}%`
export const TOAST_MS = 3000

const spreadText = (order: string[], values?: Record<string, number>) => {
  const entries = order.filter(key => values?.[key] !== undefined && Number.isFinite(values[key]) && values[key]! >= 0 && values[key]! <= 1)
  return entries.length ? entries.map(key => `${key} ${pct(values![key]!)}`).join(' / ') : t('notProvided')
}

/** Shared by the persistent hover panel and transient decision hint. */
export function toastText(d: Decision): string[] {
  return [
    `${d.source === 'main' ? t('sourceMain') : t('sourceChild')} · ${d.status === 'applied' ? t('statusApplied') : d.status === 'failed' ? t('statusFailed') : d.status === 'unsupported' ? t('statusUnsupported') : t('statusPending')}`,
    // Only judged decisions carry a preset; an unregistered id (e.g. after a downgrade) is shown verbatim.
    ...(d.preset ? [t('presetLine', { preset: resolvePreset(d.preset).id === d.preset ? localized(resolvePreset(d.preset).title) : d.preset })] : []),
    ...(d.capability ? [t('capabilityLine', { capability: d.capability, confidence: d.capabilityConfidence === undefined ? t('notProvided') : pct(d.capabilityConfidence) })] : []),
    ...(d.capability ? [t('capabilitySpread', { list: spreadText(['bounded', 'analytical', 'frontier', 'insufficient_context'], d.capabilityProbabilities) })] : []),
    t('depthLine', { depth: d.depth, confidence: d.confidence === undefined ? t('notProvided') : pct(d.confidence) }),
    t('depthSpread', { list: spreadText(['lower', 'baseline', 'higher'], d.probabilities) }),
    `${d.provider ?? ''} / ${d.model ?? t('toBeDetermined')} · ${d.effort}`,
    `${d.decisionProvider ?? t('unknownService')} / ${d.decisionModel ?? t('unknownModel')} · ${(d.ms / 1000).toFixed(2)}s`,
    t('confidenceFormula'),
  ]
}

/** A hint is shown only for a decision id not seen before (it is hidden TOAST_MS later by the chip). */
export function nextToast(seen: number | undefined, d: Decision | undefined): Toast | undefined {
  if (!d || d.id === seen) return undefined
  return { id: d.id, lines: toastText(d) }
}
