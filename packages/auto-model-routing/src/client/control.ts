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
export interface Decision { id: number; source: 'main' | 'subagent'; tier?: string; effort: string; model?: string; confidence?: number; probabilities?: Record<string, number>; ms: number; depth: string; capability?: string; capabilityConfidence?: number; capabilityProbabilities?: Record<string, number>; decisionProvider?: string; decisionModel?: string; provider?: string; status?: string }
export interface Toast { id: number; lines: string[] }
const pct = (v: number) => `${Math.round(v * 100)}%`
export const TOAST_MS = 3000

const spreadText = (order: string[], values?: Record<string, number>) => {
  const entries = order.filter(key => values?.[key] !== undefined && Number.isFinite(values[key]) && values[key]! >= 0 && values[key]! <= 1)
  return entries.length ? entries.map(key => `${key} ${pct(values![key]!)}`).join(' / ') : '未提供'
}

/** Shared by the persistent hover panel and transient decision hint. */
export function toastText(d: Decision): string[] {
  return [
    `${d.source === 'main' ? '主会话' : '子任务'} · ${d.status === 'applied' ? '已应用' : d.status === 'failed' ? '未应用' : d.status === 'unsupported' ? '不支持调整' : '已判断/待应用'}`,
    ...(d.capability ? [`能力 ${d.capability} · 判定确定度 ${d.capabilityConfidence === undefined ? '未提供' : pct(d.capabilityConfidence)}`] : []),
    ...(d.capability ? [`能力分布：${spreadText(['bounded', 'analytical', 'frontier', 'insufficient_context'], d.capabilityProbabilities)}`] : []),
    `投入 ${d.depth} · 判定确定度 ${d.confidence === undefined ? '未提供' : pct(d.confidence)}`,
    `投入分布：${spreadText(['lower', 'baseline', 'higher'], d.probabilities)}`,
    `${d.provider ?? ''} / ${d.model ?? '待确定'} · ${d.effort}`,
    `${d.decisionProvider ?? '未知服务'} / ${d.decisionModel ?? '未知模型'} · ${(d.ms / 1000).toFixed(2)}s`,
    '确定度 = (最高概率 − 1/n) ÷ (1 − 1/n)，n 为候选数；不是任务成功率',
  ]
}

/** A hint is shown only for a decision id not seen before (it is hidden TOAST_MS later by the chip). */
export function nextToast(seen: number | undefined, d: Decision | undefined): Toast | undefined {
  if (!d || d.id === seen) return undefined
  return { id: d.id, lines: toastText(d) }
}
