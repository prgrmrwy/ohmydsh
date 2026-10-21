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
