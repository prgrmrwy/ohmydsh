import { createElement as h, type ReactNode } from 'react'
import { expiryHint, formatTime, readTime, resetAccount, resetBlock, windowReading, type Card, type CardReset, type CardResets, type CardWindow } from './view-model.js'
import { t } from './locales.js'

/**
 * One usage card. Every gateway string is a React text child (never HTML),
 * absent fields are omitted. The only controls are "刷新" and — on a card whose
 * resets the host marked redeemable — "使用…" on the credit that expires first.
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

/** The reset area's disclosure arrow: a 12px glyph, so the unfolded rows line up with the title text. */
const ResetChevron = () => h('svg', { className: 'dmg-reset-chevron', 'aria-hidden': true, width: 12, height: 12, viewBox: '0 0 16 16' },
  h('path', { d: 'm6 3 5 5-5 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))

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
function resetItem(item: CardReset, soonest: number | undefined, key: string, action?: ReactNode) {
  const at = item.until
  const hint = present(at) && soonest !== undefined && Date.parse(at!) === soonest ? expiryHint(at!) : undefined
  return h('div', { className: 'dmg-reset-item', 'data-reset-item': '', key },
    h('span', { className: 'dmg-reset-kind' },
      h('span', null, windowLabel(item.window) ?? t('resetCreditFull')),
      action === undefined ? null : action),
    h('span', { className: 'dmg-reset-when' },
      present(at) ? expiryTime(at!) : t('resetCreditExpiryUnknown'),
      hint === undefined ? null : [' · ', hint]))
}

/** The "use" button of one credit: disabled state is explained on hover, never silently inert. */
function resetButton(card: Card, busy: boolean, blocked: boolean, onReset: (() => void) | undefined) {
  const reason = resetBlock(card)
  const label = busy ? t('resetUseChecking') : t('resetUseButton')
  const title = busy ? t('resetUseChecking') : reason === 'guard' ? t('resetUseGuard') : reason === 'refresh' ? t('resetUseRefresh') : reason === 'restart' ? t('resetUseRestart') : t('resetUseReady')
  const inactive = busy || blocked || reason !== undefined
  return h('button', {
    type: 'button', className: 'dmg-reset-use', 'data-reset-use': '', 'aria-disabled': inactive ? 'true' : 'false', title,
    ...(inactive ? {} : { 'data-ready': '' }),
    onClick: () => { if (!inactive) onReset?.() },
  }, label)
}

/**
 * The card's reset credits, folded like the subscriptions plugin does: the count
 * on the summary line, every credit and its expiry when opened, and the use
 * action on the credit that runs out first.
 */
function ResetLine({ card, resets, busy, blocked, onReset }: { card: Card; resets: CardResets; busy: boolean; blocked: boolean; onReset?: ((card: Card) => void) | undefined }) {
  const each = resets.each ?? []
  const items: CardReset[] = each.length ? each : present(resets.until) ? [{ until: resets.until! }] : []
  const times = items.flatMap(item => { const at = present(item.until) ? Date.parse(item.until!) : NaN; return Number.isNaN(at) ? [] : [at] })
  // The soonest credit carries the relative hint and the use action; it is the one worth not wasting.
  const soonest = times.length ? Math.min(...times) : undefined
  const count = resetCount(resets)
  if (count === null && items.length === 0) return null
  // The host marks the card, but the premise is also checked here: only a named Codex
  // account can be spent for, and without that there is nothing to send.
  const actionable = resets.redeemable === true && resetAccount(card) !== undefined && onReset !== undefined
  return h('details', { className: 'dmg-resets', 'data-field': 'resets' },
    h('summary', null,
      h('span', { className: 'dmg-reset-chevron-slot', 'aria-hidden': true }, h(ResetChevron, null)),
      h('span', null, t('resetCreditsTitle')),
      count === null ? null : h('span', { className: 'dmg-resets-count' }, count)),
    items.length ? h('div', { className: 'dmg-reset-items' }, ...items.map((item, index) => {
      const at = present(item.until) ? Date.parse(item.until!) : NaN
      // A credit with no expiry never runs out, so every credit ties; the first one
      // then stands in for "soonest" instead of leaving the card without an action.
      const isSoonest = soonest === undefined ? index === 0 : !Number.isNaN(at) && at === soonest
      return resetItem(item, soonest, `reset-${index}`, actionable && isSoonest ? resetButton(card, busy, blocked, () => onReset(card)) : undefined)
    })) : null)
}

export function UsageCard({ card, busy, onRefresh, disabled, resetBusy, resetStatus, onReset }: {
  card: Card; busy: boolean; onRefresh: () => void; disabled?: boolean
  resetBusy?: boolean; resetStatus?: { text: string; tone: 'ok' | 'error' | 'warn' }; onReset?: (card: Card) => void
}) {
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
      h('button', { type: 'button', className: 'dmg-button', disabled: busy || disabled === true, onClick: onRefresh }, t('refresh'))),
    facts.length ? h('div', { className: 'dmg-facts' }, ...facts) : null,
    ...(card.windows ?? []).map((window, index) => h(WindowRow, { key: `window-${index}`, window })),
    resets ? h(ResetLine, { resets, card, busy: resetBusy === true, blocked: disabled === true, onReset }) : null,
    resetStatus ? h('p', { className: resetStatus.tone === 'error' ? 'dmg-error' : resetStatus.tone === 'warn' ? 'dmg-warn' : 'dmg-ok', role: resetStatus.tone === 'error' ? 'alert' : 'status', 'data-reset-status': resetStatus.tone }, resetStatus.text) : null,
    present(card.error) ? h('p', { className: 'dmg-error', 'data-field': 'error', role: 'alert' }, card.error) : null)
}
