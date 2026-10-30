/**
 * Client-side shapes of the D10 resources. Every field the host may omit is
 * optional here and is simply not rendered when absent — the page never
 * fabricates placeholders or inferred values.
 */
import { t } from './locales.js'
export interface CardWindow { name?: string; used?: number; resetsAt?: string; unlimited?: boolean; display?: string }
export interface Card {
  provider: string; name?: string; icon?: string; user?: string; plan?: string; until?: string; renew?: string | boolean
  balance?: string | number; readAt?: string; asOf?: string; error?: string
  windows?: CardWindow[]; resets?: { count?: number; until?: string }
}
export type CardsStatus = 'ok' | 'forbidden' | 'error' | 'unconfigured'
export interface CardsView { status: CardsStatus; error?: string; cards: Card[] }

export interface ModelRow { id: string; name?: string; efforts?: string[]; visible?: boolean }
export interface ModelGroup { provider: string; models: ModelRow[] }
export type SyncErrorKind = 'unauthorized' | 'forbidden' | 'http' | 'unreachable' | 'settings' | 'registration'
export interface LineView {
  id?: string; baseUrl?: string; accessMode?: 'direct' | 'cloudflare'; complete?: boolean
  key?: { configured?: boolean; writable?: boolean }
  access?: { clientId?: { configured?: boolean; writable?: boolean }; clientSecret?: { configured?: boolean; writable?: boolean } }
  refs?: { key?: string; accessClientId?: string; accessClientSecret?: string }
}
export interface SettingsView {
  lines?: LineView[]; activeLineId?: string | null
  pending?: { lineId?: string; field?: string }[]
  retainedCredentials?: { lineId?: string; field?: string }[]
  access?: { clientId?: { configured?: boolean; writable?: boolean }; clientSecret?: { configured?: boolean; writable?: boolean } }
  lastSyncAt?: string; lastSyncError?: string; lastSyncErrorKind?: SyncErrorKind
  groups?: ModelGroup[]; visibleModels?: Record<string, string[]>; defaultEfforts?: Record<string, string>
  /** Initial route registration failed (design D6): the host must be restarted to recover. */
  routeRegistrationError?: { code: string; route?: string }
  /** knownOwners was invalid at load and reset to empty (spec 归属 route 持久). */
  knownOwnersReset?: boolean
  /** The owner cap (32) rejected new owners; `rejectedOwners` lists them. */
  ownerLimitReached?: boolean; rejectedOwners?: string[]
}

const str = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** One read-only line check result, exactly as the host classified it. */
export interface CheckSnapshot {
  kind: string; gatewayStatus?: number; reason?: string; latencyMs: number
  modelCount?: number; models?: { id: string }[]; testedAt: string
}

/** Defensive parse of the line-check response: no fabricated fields, unknown kinds dropped. */
export function parseCheck(body: unknown): CheckSnapshot | undefined {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!str(raw.kind) || typeof raw.latencyMs !== 'number' || !Number.isFinite(raw.latencyMs)) return undefined
  const models = Array.isArray(raw.models)
    ? raw.models.filter((entry): entry is { id: string } => !!entry && typeof entry === 'object' && str((entry as { id?: unknown }).id)).map(entry => ({ id: entry.id }))
    : undefined
  return {
    kind: raw.kind, latencyMs: Math.max(0, Math.round(raw.latencyMs)),
    ...(typeof raw.gatewayStatus === 'number' ? { gatewayStatus: raw.gatewayStatus } : {}),
    ...(str(raw.reason) ? { reason: raw.reason } : {}),
    ...(typeof raw.modelCount === 'number' ? { modelCount: raw.modelCount } : {}),
    ...(models ? { models } : {}),
    ...(str(raw.testedAt) ? { testedAt: raw.testedAt } : {}),
  } as CheckSnapshot
}

/** Everything that makes a snapshot stale for one card: identity plus unsaved credential edits. */
export const checkSignature = (draft: { id?: string | undefined; baseUrl: string; accessMode: string; apiKey: string; accessClientId: string; accessClientSecret: string }) =>
  JSON.stringify([draft.id ?? null, draft.baseUrl.trim(), draft.accessMode, draft.apiKey, draft.accessClientId, draft.accessClientSecret])

/** Cached catalog ids the snapshot is compared against (never the live "current line" catalog). */
export const cacheIds = (groups: ModelGroup[] | undefined): string[] => (groups ?? []).flatMap(group => group.models.map(model => model.id))

/**
 * Diff against the cached catalog. Comparing only complete model ids keeps both sides comparable:
 * the cache exposes raw `provider` keys while the check result carries no ownership at all.
 */
export function checkDiff(snapshot: CheckSnapshot, cache: string[]): { added: string[]; removed: string[] } | undefined {
  if (!snapshot.models) return undefined
  const have = new Set(snapshot.models.map(model => model.id))
  const known = new Set(cache)
  return { added: [...have].filter(id => !known.has(id)), removed: [...known].filter(id => !have.has(id)) }
}

/** Defensive parse: unknown or malformed entries never reach the renderer. */
export function parseCards(body: unknown, httpStatus: number): CardsView {
  const raw = (body && typeof body === 'object' ? body : {}) as { status?: unknown; error?: unknown; cards?: unknown }
  const ok = httpStatus >= 200 && httpStatus < 300
  const known = ['ok', 'forbidden', 'error', 'unconfigured'] as const
  const status: CardsStatus = known.includes(raw.status as CardsStatus) ? raw.status as CardsStatus
    : httpStatus === 403 ? 'forbidden' : ok ? 'ok' : 'error'
  const cards = Array.isArray(raw.cards) ? raw.cards.filter((c): c is Card => !!c && typeof c === 'object' && str((c as Card).provider)) : []
  return { status, ...(str(raw.error) ? { error: raw.error } : {}), cards }
}

/** Time string from the gateway: a parseable instant renders localized, anything else verbatim. */
export function formatTime(raw: string): string {
  const time = Date.parse(raw)
  return Number.isNaN(time) ? raw : new Date(time).toLocaleString()
}

/** Window reading, by precedence unlimited > display > used%. Undefined means "show no reading". */
export function windowReading(window: CardWindow): string | undefined {
  if (window.unlimited === true) return t('unlimited')
  if (str(window.display)) return window.display
  if (typeof window.used === 'number' && Number.isFinite(window.used)) return `${Math.round(window.used * 10) / 10}%`
  return undefined
}

export const readTime = (card: Card) => card.readAt ?? card.asOf
export const cardKey = (card: Pick<Card, 'provider' | 'user'>) => `${card.provider}\u0000${card.user ?? ''}`
export const sameTarget = (a: Card, b: Pick<Card, 'provider' | 'user'>) => a.provider === b.provider && (a.user ?? undefined) === (b.user ?? undefined)

/** Provider groups in page order: catalog groups first, then card-only providers (never dropped). */
export function providerOrder(groups: ModelGroup[], cards: Card[]): string[] {
  const order = groups.map(g => g.provider)
  for (const card of cards) if (!order.includes(card.provider)) order.push(card.provider)
  return order
}
