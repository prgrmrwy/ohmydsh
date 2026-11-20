import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
/** Fixed pi-ai/replay transport identity. It is NOT a registered LLM route. */
export const TRANSPORT_ID = 'dsh-magpie-connector'
const ROUTE_PREFIX = `${TRANSPORT_ID}-`
const OWNER_KEY = /^[a-z0-9][a-z0-9._-]*$/
const ROUTE = /^dsh-magpie-connector-[a-z0-9][a-z0-9._-]{0,47}$/
/** Owner key of a gateway `owned_by` (untrusted): valid lower-cased value, else `other`. */
export function ownerKey(ownedBy: unknown): string {
  if (typeof ownedBy !== 'string') return 'other'
  const key = ownedBy.trim().toLowerCase()
  return key.length >= 1 && key.length <= 48 && OWNER_KEY.test(key) ? key : 'other'
}
/** Display name depends on the owner key alone, never on catalog content. */
export const ownerLabel = (key: string): string => key === 'other' ? 'Magpie (Other)' : `Magpie (${key.charAt(0).toUpperCase()}${key.slice(1)})`
export const routeOf = (key: string): string => `${ROUTE_PREFIX}${key}`
export const isMagpieRoute = (id: string): boolean => ROUTE.test(id)
/** Owner key of one of our routes; anything else (direct adapter calls) reads as `other`. */
export const ownerOfRoute = (route: string): string => isMagpieRoute(route) ? route.slice(ROUTE_PREFIX.length) : 'other'
/** The gateway's `max_output_tokens`, the model's reply capacity; `info.defaultMaxTokens` is the smaller per-request budget. */
/** Owner and visibility key of every routing entry (`group/…`, `auto/…`): Magpie routing groups belong to no vendor. */
export const ROUTING_OWNER = 'routing'
export type RoutingKind = 'auto' | 'custom'
/** Routing entry type by id prefix only (case-sensitive); labels are presentation text and never decide the type. */
export const routingKindOf = (id: string): RoutingKind | undefined =>
  id.startsWith('auto/') || id.startsWith('group/auto-') ? 'auto' : id.startsWith('group/') ? 'custom' : undefined
export interface CatalogModel { info: LlmResolvedModelInfo; /** Visibility key: raw `owned_by`, else the id's first segment; `routing` for routing entries. */ provider: string; /** Owner key that selects the route. */ owner: string; routingKind?: RoutingKind; efforts: string[]; nativeEndpoints: string[]; serviceTiers: string[]; outputLimit?: number }
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
    const info: LlmResolvedModelInfo = {
      provider: TRANSPORT_ID, id: raw.id, name: typeof raw.display_name === 'string' && raw.display_name ? raw.display_name : raw.id,
      inputModalities: strings(raw.modalities?.input).includes('image') ? ['text', 'image'] : ['text'],
      ...(contextWindow !== undefined ? { context: { contextWindow } } : {}),
      ...(outputLimit !== undefined ? { defaultMaxTokens: defaultOutputBudget(contextWindow, outputLimit) } : {}),
      ...(efforts.length ? { reasoning: { efforts: efforts.map(id => ({ id: id as never, name: id })) } } : {}),
    }
    const routingKind = routingKindOf(raw.id)
    // `routing` names routing entries only; an ordinary model that would also map to it falls back to `other`.
    const visibility = ownedBy ?? raw.id.split('/')[0], owner = ownerKey(raw.owned_by)
    const keys = routingKind ? { provider: ROUTING_OWNER, owner: ROUTING_OWNER, routingKind }
      : { provider: visibility.toLowerCase() === ROUTING_OWNER ? 'other' : visibility, owner: owner === ROUTING_OWNER ? 'other' : owner }
    return [{ info, ...keys, efforts, ...(outputLimit !== undefined ? { outputLimit } : {}),
      nativeEndpoints: strings(raw.native_endpoints), serviceTiers: Array.isArray(raw.service_tiers) ? raw.service_tiers.flatMap((t: { id?: unknown }) => typeof t?.id === 'string' ? [t.id] : []) : [] }]
  })
}
