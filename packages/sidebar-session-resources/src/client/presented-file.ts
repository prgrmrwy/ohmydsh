import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'

/** Resolve only the exact declaration addressed by the owning card's official action route. */
export function pathForPresentedAction(snapshot: ChatSnapshot, sessionId: string, actionUrl: string): string | undefined {
  let url: URL
  try {
    url = new URL(actionUrl, 'https://dsh.invalid/')
  } catch {
    return undefined
  }
  if (!url.pathname.endsWith('/api/present.open') || url.searchParams.get('sessionId') !== sessionId) return undefined
  const rawSeq = url.searchParams.get('seq')
  const rawIndex = url.searchParams.get('index')
  if (rawSeq === null || rawIndex === null || !/^\d+$/.test(rawSeq) || !/^\d+$/.test(rawIndex)) return undefined
  const seq = Number(rawSeq)
  const index = Number(rawIndex)
  if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(index)) return undefined
  for (const turn of snapshot.timeline.turns.values()) {
    // 0.2.2 publishes this Location key but omits its type from the public /client export.
    const data = (turn.data as { get(key: string): unknown }).get('deliverables')
    if (typeof data !== 'object' || data === null || !('presented' in data) || !Array.isArray(data.presented)) continue
    for (const file of data.presented) {
      if (typeof file !== 'object' || file === null) continue
      if (file.seq === seq && file.index === index && typeof file.path === 'string' && file.path.trim() !== '') return file.path
    }
  }
  return undefined
}
