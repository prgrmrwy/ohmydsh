import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
type DisplayModelInfo = LlmResolvedModelInfo & { displayGroup?: { id: string; label: string } }
/** The gateway's `max_output_tokens`, the model's reply capacity; `info.defaultMaxTokens` is the smaller per-request budget. */
export interface CatalogModel { info: DisplayModelInfo; provider: string; efforts: string[]; nativeEndpoints: string[]; serviceTiers: string[]; outputLimit?: number }
/**
 * DSH compaction-basic's default `headroomTokens` (DSH 0.2.0-rc.2, lib/index.js) and Magpie's `dshHeadroom`.
 * Re-check on every DSH upgrade: DSH reserves `defaultMaxTokens` plus this headroom out of the window before compacting.
 */
export const COMPACTION_HEADROOM_TOKENS = 65536
/** Magpie's `dshMaxTokens` (without its user-set Max output exception, which /models does not expose). */
export const defaultOutputBudget = (contextWindow: number | undefined, outputLimit: number): number =>
  contextWindow === undefined ? outputLimit : Math.min(outputLimit, Math.max(1, Math.floor(contextWindow / 4), Math.floor(contextWindow / 2) - COMPACTION_HEADROOM_TOKENS))
const positive = (value: unknown): number | undefined => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : []
export function mapCatalog(body: unknown): CatalogModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('Invalid model catalog')
  return data.flatMap(raw => {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return []
    const efforts = [...new Set(strings(raw.reasoning_levels))]
    const ownedBy = typeof raw.owned_by === 'string' && raw.owned_by ? raw.owned_by : undefined
    const contextWindow = positive(raw.context_window), outputLimit = positive(raw.max_output_tokens)
    const info: DisplayModelInfo = {
      provider: 'dsh-magpie-connector', id: raw.id, name: typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : raw.id,
      // Namespace raw owners so a real 'other' cannot collide with missing ownership.
      displayGroup: ownedBy === undefined ? { id: 'other', label: 'Magpie (Other)' }
        : { id: ownedBy === 'claude' || ownedBy === 'codex' ? ownedBy : `owned-by:${ownedBy}`, label: `Magpie (${ownedBy === 'claude' ? 'Claude' : ownedBy === 'codex' ? 'GPT' : ownedBy})` },
      inputModalities: strings(raw.modalities?.input).includes('image') ? ['text', 'image'] : ['text'],
      ...(contextWindow !== undefined ? { context: { contextWindow } } : {}),
      ...(outputLimit !== undefined ? { defaultMaxTokens: defaultOutputBudget(contextWindow, outputLimit) } : {}),
      ...(efforts.length ? { reasoning: { efforts: efforts.map(id => ({ id: id as never, name: id })) } } : {}),
    }
    return [{ info, provider: ownedBy ?? raw.id.split('/')[0], efforts, ...(outputLimit !== undefined ? { outputLimit } : {}),
      nativeEndpoints: strings(raw.native_endpoints), serviceTiers: Array.isArray(raw.service_tiers) ? raw.service_tiers.flatMap((t: { id?: unknown }) => typeof t?.id === 'string' ? [t.id] : []) : [] }]
  })
}
