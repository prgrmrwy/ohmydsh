/**
 * Pure helpers for the sidebar usage card. No React, no locale binding: the
 * component owns copy, this module owns which window is shown and how a value
 * is compared, so the rules stay testable without a DOM.
 *
 * @module dsh-magpie-connector/client/sidebar-view
 */
import type { Card, CardWindow } from './view-model.js'
import { DEFAULT_SIDEBAR_WINDOW, type SidebarWindowMode } from '../shared/sidebar-window.js'

/** The weekly window: the gateway names it freely (`7 days`, `weekly`, `周`…). */
const WEEKLY = /7\s*days?|week|weekly|周/i
/** The short rolling window; gateways write `5 hours`, `5-hour`, `5h`, `五小时`. */
const FIVE_HOUR = /(?:^|[^0-9])5[\s-]*(?:hours?|hrs?|h)\b|five[\s-]*hours?|5\s*小时|五小时/i

/** Colour tier of one reading; same thresholds as the settings page (AMD4). */
export type UsageLevel = 'normal' | 'warn' | 'high'

export const usedLevel = (used: number): UsageLevel => used >= 90 ? 'high' : used > 70 ? 'warn' : 'normal'

const numericWindows = (card: Card): CardWindow[] =>
  (card.windows ?? []).filter((window): window is CardWindow & { used: number } => typeof window.used === 'number' && Number.isFinite(window.used))

const tightest = (windows: CardWindow[]): CardWindow => windows.reduce((best, window) => (window.used! > best.used! ? window : best))

const named = (windows: CardWindow[], pattern: RegExp): CardWindow[] =>
  windows.filter(window => typeof window.name === 'string' && pattern.test(window.name))

/** The window one compact row shows, plus whether the configured tier was missing. */
export interface WindowChoice {
  window?: CardWindow
  /** The configured tier does not exist upstream, so the row shows the nearest available thing. */
  fallback: boolean
}

/**
 * The one window the compact row shows. `weekly` (the default) prefers the weekly
 * window, `fiveHour` the 5-hour window, `tightest` the highest reading; each falls
 * back to the nearest available window rather than inventing one, and a gateway
 * that reports no numbers at all still surfaces its own `display`/`unlimited`
 * text. The label stays the gateway's own.
 */
export function selectWindow(card: Card, mode: SidebarWindowMode = DEFAULT_SIDEBAR_WINDOW): WindowChoice {
  const numeric = numericWindows(card)
  const weekly = named(numeric, WEEKLY)
  const fiveHour = named(numeric, FIVE_HOUR)
  const preferred = mode === 'weekly' ? weekly : mode === 'fiveHour' ? fiveHour : numeric
  if (preferred.length > 0) return { window: tightest(preferred), fallback: false }
  const nearest = mode === 'fiveHour' && weekly.length > 0 ? weekly : numeric
  if (nearest.length > 0) return { window: tightest(nearest), fallback: true }
  const display = (card.windows ?? []).find(window => window.unlimited === true || (typeof window.display === 'string' && window.display !== ''))
  return display === undefined ? { fallback: true } : { window: display, fallback: true }
}

/** One compact row: which card, which window, and what to render inside it. */
export interface SidebarRow {
  card: Card
  window?: CardWindow
  /** Clamped used percentage when the gateway reported a usable number. */
  used?: number
  /** Gateway display string, rendered verbatim. */
  display?: string
  unlimited?: boolean
  /** Balance-only accounts (no quota windows): shown instead of a dash. */
  balance?: string
  /** The card itself failed: the row shows the failure instead of a reading. */
  failed: boolean
  /** The row does not show the configured tier because the upstream does not report it. */
  fallback?: boolean
}

/** Rows in gateway order (the product decision: no current-first, no severity sort). */
export function sidebarRows(cards: Card[], mode: SidebarWindowMode = DEFAULT_SIDEBAR_WINDOW): SidebarRow[] {
  return cards.map(card => {
    const { window, fallback } = selectWindow(card, mode)
    const used = typeof window?.used === 'number' && Number.isFinite(window.used) ? Math.min(100, Math.max(0, window.used)) : undefined
    return {
      card,
      ...(window === undefined ? {} : { window }),
      ...(used === undefined ? {} : { used }),
      ...(typeof window?.display === 'string' && window.display !== '' ? { display: window.display } : {}),
      ...(window?.unlimited === true ? { unlimited: true } : {}),
      ...(card.balance === undefined || card.balance === null || card.balance === '' ? {} : { balance: String(card.balance) }),
      fallback,
      failed: typeof card.error === 'string' && card.error !== '',
    }
  })
}

/** `8` → `8%`, `70.5` → `70.5%` (same rounding as the settings page). */
export const formatUsed = (used: number): string => `${Math.round(used * 10) / 10}%`

/** Whole minutes since a gateway read timestamp; undefined when unparseable. */
export function ageMinutes(readAt: string | undefined, now: number): number | undefined {
  if (readAt === undefined || readAt === '') return undefined
  const time = Date.parse(readAt)
  if (Number.isNaN(time)) return undefined
  return Math.max(0, Math.floor((now - time) / 60_000))
}

const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * Compact reset label for the 220px expanded card: `19:20` when it is today,
 * `11/10 11:00` within the year, otherwise the full date. The full timestamp is
 * always available in `title` and on the settings page.
 */
export function formatResetShort(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined || resetsAt === '') return undefined
  const time = Date.parse(resetsAt)
  if (Number.isNaN(time)) return undefined
  const reset = new Date(time)
  const today = new Date(now)
  const clock = `${pad(reset.getHours())}:${pad(reset.getMinutes())}`
  if (reset.getFullYear() !== today.getFullYear()) return `${reset.getFullYear()}/${reset.getMonth() + 1}/${reset.getDate()} ${clock}`
  if (reset.getMonth() !== today.getMonth() || reset.getDate() !== today.getDate()) return `${reset.getMonth() + 1}/${reset.getDate()} ${clock}`
  return clock
}

/**
 * Reset label for one compact sidebar row: always a date and a clock
 * (`11/10 11:00`, `2027/1/2 09:05` when it is another year). The compact row
 * keeps the date even for a reset later today on purpose: the gateway's window
 * name (`7 days`) says nothing about when the quota comes back, and the row has
 * no other place to put it.
 */
export function formatResetDeadline(resetsAt: string | undefined, now: number): string | undefined {
  if (resetsAt === undefined || resetsAt === '') return undefined
  const time = Date.parse(resetsAt)
  if (Number.isNaN(time)) return undefined
  const reset = new Date(time)
  const clock = `${pad(reset.getHours())}:${pad(reset.getMinutes())}`
  const day = `${reset.getMonth() + 1}/${reset.getDate()} ${clock}`
  return reset.getFullYear() === new Date(now).getFullYear() ? day : `${reset.getFullYear()}/${day}`
}

/** Stable identity of one card across reads: provider + account. */
export const cardIdentity = (card: Pick<Card, 'provider' | 'user'>): string => `${card.provider}\u0000${card.user ?? ''}`

export const cardReadTime = (card: Card): string | undefined => card.readAt ?? card.asOf

/**
 * Did a full refresh leave every card's read time untouched? Same rule the
 * settings page uses for "Magpie did not re-read (throttled)".
 */
export function unchangedReads(previous: Card[], next: Card[]): boolean {
  if (previous.length === 0 || next.length !== previous.length) return false
  const before = new Map(previous.map(card => [cardIdentity(card), cardReadTime(card)]))
  return next.every(card => before.has(cardIdentity(card)) && before.get(cardIdentity(card)) === cardReadTime(card))
}
