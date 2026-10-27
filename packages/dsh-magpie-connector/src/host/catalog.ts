import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
type DisplayModelInfo = LlmResolvedModelInfo & { displayGroup?: { id: string; label: string } }
export interface CatalogModel { info: DisplayModelInfo; provider: string; efforts: string[]; nativeEndpoints: string[]; serviceTiers: string[] }
export const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v) : []
export function mapCatalog(body: unknown): CatalogModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('Invalid model catalog')
  return data.flatMap(raw => {
    if (!raw || typeof raw.id !== 'string' || !raw.id) return []
    const efforts = [...new Set(strings(raw.reasoning_levels))]
    const ownedBy = typeof raw.owned_by === 'string' && raw.owned_by ? raw.owned_by : undefined
    const info: DisplayModelInfo = {
      provider: 'dsh-magpie-connector', id: raw.id, name: typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : raw.id,
      // Namespace raw owners so a real 'other' cannot collide with missing ownership.
      displayGroup: ownedBy === undefined ? { id: 'other', label: 'Magpie (Other)' }
        : { id: ownedBy === 'claude' || ownedBy === 'codex' ? ownedBy : `owned-by:${ownedBy}`, label: `Magpie (${ownedBy === 'claude' ? 'Claude' : ownedBy === 'codex' ? 'GPT' : ownedBy})` },
      inputModalities: strings(raw.modalities?.input).includes('image') ? ['text', 'image'] : ['text'],
      ...(Number.isSafeInteger(raw.context_window) && raw.context_window > 0 ? { context: { contextWindow: raw.context_window } } : {}),
      ...(Number.isSafeInteger(raw.max_output_tokens) && raw.max_output_tokens > 0 ? { defaultMaxTokens: raw.max_output_tokens } : {}),
      ...(efforts.length ? { reasoning: { efforts: efforts.map(id => ({ id: id as never, name: id })) } } : {}),
    }
    return [{ info, provider: ownedBy ?? raw.id.split('/')[0], efforts,
      nativeEndpoints: strings(raw.native_endpoints), serviceTiers: Array.isArray(raw.service_tiers) ? raw.service_tiers.flatMap((t: { id?: unknown }) => typeof t?.id === 'string' ? [t.id] : []) : [] }]
  })
}
