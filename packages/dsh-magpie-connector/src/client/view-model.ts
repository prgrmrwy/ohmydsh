/**
 * Client-side shapes of the D10 resources. Every field the host may omit is
 * optional here and is simply not rendered when absent — the page never
 * fabricates placeholders or inferred values.
 */
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
export type SyncErrorKind = 'unauthorized' | 'forbidden' | 'http' | 'unreachable'
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
}

const str = (value: unknown): value is string => typeof value === 'string' && value !== ''

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
  if (window.unlimited === true) return '无限'
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
