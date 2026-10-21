export interface Rpc { call(channel: string, endpoint: string, payload: unknown): Promise<{ok: boolean; value?: unknown; error?: {message?: string}}> }
export async function callRouting(rpc: Rpc, sessionId: string, mode?: 'AUTO' | 'MANUAL'): Promise<unknown> {
  const result = await rpc.call('/api', `auto-model-routing.${mode ? 'setMode' : 'state'}`, { sessionId, ...(mode ? { mode } : {}) })
  if (!result.ok) throw new Error(result.error?.message ?? '路由状态请求失败')
  return result.value
}
export const chipOrder = -10
/** Panel visibility: entering or focusing the chip (or its panel) opens it; leaving or blurring closes it. */
export type PanelEvent = 'enter' | 'focus' | 'leave' | 'blur'
export const panelOpenAfter = (event: PanelEvent): boolean => event === 'enter' || event === 'focus'

/** Latest Jev decision as returned by the state endpoint when the hint switch is on. */
export interface Decision { id: number; source: 'main' | 'subagent'; tier: string; effort: string; model?: string; confidence?: number; probabilities?: Record<string, number>; ms: number }
export interface Toast { id: number; lines: string[] }
const TIER_ORDER = ['simple', 'standard', 'complex', 'escalated']
const pct = (v: number) => `${Math.round(v * 100)}%`
export const TOAST_MS = 3000

/** Line 1: who judged, tier → (model) effort, duration. Line 2: the distribution in tier order, 0% tiers omitted. */
export function toastText(d: Decision): string[] {
  const head = [
    d.source === 'main' ? '主会话判断' : '子会话判断',
    `${d.tier} → ${d.model ? `${d.model} · ` : ''}${d.effort}`,
    `${(d.ms / 1000).toFixed(2)}s`,
  ].join(' · ')
  const spread = TIER_ORDER.filter(t => d.probabilities?.[t] !== undefined && Math.round(d.probabilities[t]! * 100) > 0)
    .map(t => `${t} ${pct(d.probabilities![t]!)}`).join(' / ')
  return spread ? [head, spread] : [head]
}

/** A hint is shown only for a decision id not seen before (it is hidden TOAST_MS later by the chip). */
export function nextToast(seen: number | undefined, d: Decision | undefined): Toast | undefined {
  if (!d || d.id === seen) return undefined
  return { id: d.id, lines: toastText(d) }
}
