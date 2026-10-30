import { createElement as h, type ReactNode } from 'react'
import { formatTime, readTime, windowReading, type Card, type CardWindow } from './view-model.js'
import { t } from './locales.js'

/**
 * One read-only usage card. Every gateway string is a React text child (never
 * HTML), absent fields are omitted, and the only control is "刷新" — there is
 * deliberately no reset action (the Codex reset count is display-only).
 */
const time = (raw: string) => h('time', { dateTime: raw }, formatTime(raw))
const fact = (field: string, label: string, value: ReactNode) => h('span', { 'data-field': field, key: field }, h('b', null, `${label} `), h('span', { 'data-value': '' }, value))
const scalar = (value: unknown) => typeof value === 'boolean' ? (value ? t('yes') : t('no')) : String(value)
const present = (value: unknown) => value !== undefined && value !== null && value !== ''

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
    ...(card.windows ?? []).map((window, index) => h(WindowRow, { key: index, window })),
    resets && typeof resets.count === 'number' ? h('div', { className: 'dmg-facts', 'data-field': 'resets' },
      h('span', null, h('b', null, t('resetCountLabel')), t('resetRemaining'), h('span', { 'data-reset-count': '' }, String(resets.count)), t('resetRemainingSuffix')),
      present(resets.until) ? h('span', null, h('b', null, t('resetExpiresLabel')), time(resets.until!)) : null) : null,
    present(card.error) ? h('p', { className: 'dmg-error', 'data-field': 'error', role: 'alert' }, card.error) : null)
}
