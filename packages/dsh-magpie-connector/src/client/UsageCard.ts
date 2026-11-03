import { createElement as h, type ReactNode } from 'react'
import { expiryHint, formatTime, readTime, windowReading, type Card, type CardReset, type CardResets, type CardWindow } from './view-model.js'
import { t } from './locales.js'

/**
 * One read-only usage card. Every gateway string is a React text child (never
 * HTML), absent fields are omitted, and the only control is "刷新" — there is
 * deliberately no reset action (the Codex reset credits are display-only).
 */
const time = (raw: string) => h('time', { dateTime: raw }, formatTime(raw))
/** A reset credit's expiry: the localized instant, "expires …", in one machine-readable `<time>`. */
const expiryTime = (raw: string) => h('time', { dateTime: raw }, t('resetCreditExpires', { date: formatTime(raw) }))
const fact = (field: string, label: string, value: ReactNode) => h('span', { 'data-field': field, key: field }, h('b', null, `${label} `), h('span', { 'data-value': '' }, value))
const scalar = (value: unknown) => typeof value === 'boolean' ? (value ? t('yes') : t('no')) : String(value)
const present = (value: unknown) => value !== undefined && value !== null && value !== ''

/** Children on one line, separated by the page's inline separator. */
const inline = (nodes: ReactNode[]) => nodes.flatMap((node, index) => index === 0 ? [node] : [' · ', node])

/** Which window a reset credit is for, when the gateway names one it knows. */
const windowLabel = (window: string | undefined) =>
  window === 'fiveHour' ? t('resetWindowFiveHour') : window === 'weekly' ? t('resetWindowWeekly') : undefined

/** Bar colour: ≤70% normal (blue), above 70 and below 90 warn (orange), 90% and above high (red). */
export const usageLevel = (used: number) => used >= 90 ? 'high' : used > 70 ? 'warn' : 'normal'

function WindowRow({ window }: { window: CardWindow }) {
  const reading = windowReading(window)
  const showReset = reading !== undefined && window.unlimited !== true && !present(window.display) && present(window.resetsAt)
  const used = typeof window.used === 'number' && reading?.endsWith('%') ? Math.max(0, Math.min(100, window.used)) : undefined
  return h('div', { className: 'dmg-window', 'data-window': '' },
    h('div', { className: 'dmg-window-line' },
      h('span', null,
        present(window.name) ? h('span', { 'data-window-name': '' }, window.name) : null,
        present(window.name) && reading !== undefined ? ' ' : null,
        reading !== undefined ? h('span', { 'data-reading': '' }, reading) : null),
      showReset ? h('span', null, t('usageResetAt'), time(window.resetsAt!)) : null),
    used !== undefined ? h('div', { className: 'dmg-track', 'aria-hidden': true },
      h('div', { className: 'dmg-fill', 'data-level': usageLevel(used), style: { width: `${used}%` } })) : null)
}

/** The count half of the reset summary: one count, or a count per window for plans handing out one kind each. */
function resetCount(resets: CardResets): ReactNode {
  if (resets.byWindow === true) {
    const parts = inline([
      ...(typeof resets.fiveHour === 'number' && resets.fiveHour > 0 ? [h('span', { 'data-reset-five-hour': '' }, t('resetFiveHour', { n: resets.fiveHour }))] : []),
      ...(typeof resets.weekly === 'number' && resets.weekly > 0 ? [h('span', { 'data-reset-weekly': '' }, t('resetWeekly', { n: resets.weekly }))] : []),
    ])
    return parts.length ? h('span', { 'data-reset-count': '' }, ...parts) : null
  }
  return typeof resets.count === 'number'
    ? h('span', { 'data-reset-count': '' }, t('resetCreditsAvailable', { n: resets.count }))
    : null
}

/** One reset credit: which kind it is, when it runs out and, for the soonest, how far off that is. */
function resetItem(item: CardReset, soonest: number | undefined, key: string) {
  const at = item.until
  const hint = present(at) && soonest !== undefined && Date.parse(at!) === soonest ? expiryHint(at!) : undefined
  return h('div', { className: 'dmg-reset-item', 'data-reset-item': '', key },
    h('span', null, windowLabel(item.window) ?? t('resetCreditFull')),
    h('span', null,
      present(at) ? expiryTime(at!) : t('resetCreditExpiryUnknown'),
      hint === undefined ? null : [' · ', hint]))
}

/**
 * The card's reset credits, folded like the subscriptions plugin does: the count
 * on the summary line, every credit and its expiry when opened. Read-only —
 * spending a credit is not offered here.
 */
function ResetLine({ resets }: { resets: CardResets }) {
  const each = resets.each ?? []
  const items: CardReset[] = each.length ? each : present(resets.until) ? [{ until: resets.until! }] : []
  const times = items.flatMap(item => { const at = present(item.until) ? Date.parse(item.until!) : NaN; return Number.isNaN(at) ? [] : [at] })
  // The soonest credit carries the relative hint; it is the one worth not wasting.
  const soonest = times.length ? Math.min(...times) : undefined
  const count = resetCount(resets)
  if (count === null && items.length === 0) return null
  return h('details', { className: 'dmg-resets', 'data-field': 'resets' },
    h('summary', null,
      h('span', { className: 'dmg-chevron', 'aria-hidden': true }, '▸'),
      h('span', null, t('resetCreditsTitle')),
      count === null ? null : h('span', { className: 'dmg-resets-count' }, count)),
    items.length ? h('div', { className: 'dmg-reset-items' }, ...items.map((item, index) => resetItem(item, soonest, `reset-${index}`))) : null)
}

export function UsageCard({ card, busy, onRefresh }: { card: Card; busy: boolean; onRefresh: () => void }) {
  const read = readTime(card)
  const facts = [
    present(card.user) && fact('user', t('usageUser'), card.user),
    present(card.plan) && fact('plan', t('usagePlan'), card.plan),
    present(card.until) && fact('until', t('usageUntil'), time(card.until!)),
    present(card.renew) && fact('renew', t('usageRenew'), scalar(card.renew)),
    present(card.balance) && fact('balance', t('usageBalance'), scalar(card.balance)),
    present(read) && fact('readAt', card.asOf !== undefined ? t('usageReadAtStale') : t('usageReadAt'), time(read!)),
  ].filter(Boolean)
  const resets = card.resets
  return h('article', { className: 'dmg-card', 'data-card': '' },
    h('div', { className: 'dmg-card-title' },
      h('strong', null, present(card.name) ? card.name : card.provider),
      h('button', { type: 'button', className: 'dmg-button', disabled: busy, onClick: onRefresh }, t('refresh'))),
    facts.length ? h('div', { className: 'dmg-facts' }, ...facts) : null,
    ...(card.windows ?? []).map((window, index) => h(WindowRow, { key: `window-${index}`, window })),
    resets ? h(ResetLine, { resets }) : null,
    present(card.error) ? h('p', { className: 'dmg-error', 'data-field': 'error', role: 'alert' }, card.error) : null)
}
