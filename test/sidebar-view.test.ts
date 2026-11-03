import { describe, expect, it } from 'vitest'
import {
  ageMinutes, formatResetShort, formatUsed, sidebarRows, unchangedReads, usedLevel, weeklyWindow,
} from '../src/client/sidebar-view.js'
import type { Card } from '../src/client/view-model.js'

const card = (overrides: Partial<Card>): Card => ({ provider: 'claude', ...overrides })

describe('usedLevel', () => {
  it.each([[0, 'normal'], [70, 'normal'], [70.5, 'warn'], [89.9, 'warn'], [90, 'high'], [100, 'high']] as const)('%s%% → %s', (used, level) => {
    expect(usedLevel(used)).toBe(level)
  })
})

describe('weeklyWindow', () => {
  it('prefers the weekly window over a tighter short window', () => {
    const window = weeklyWindow(card({ windows: [{ name: '5 hours', used: 90 }, { name: '7 days', used: 8 }] }))
    expect(window?.name).toBe('7 days')
    expect(window?.used).toBe(8)
  })

  it('takes the highest used weekly window when several exist', () => {
    const window = weeklyWindow(card({ windows: [{ name: '7 days', used: 8 }, { name: '7 days · Fable', used: 5 }] }))
    expect(window?.used).toBe(8)
  })

  it('accepts the other weekly spellings the gateway may use', () => {
    for (const name of ['weekly', 'Week', '每周', '7 day']) {
      expect(weeklyWindow(card({ windows: [{ name, used: 12 }] }))?.used).toBe(12)
    }
  })

  it('falls back to the tightest numeric window when no weekly window exists', () => {
    const window = weeklyWindow(card({ windows: [{ name: '5 hours', used: 44 }, { name: 'daily', used: 66 }] }))
    expect(window?.name).toBe('daily')
  })

  it('falls back to a display/unlimited window when nothing is numeric', () => {
    expect(weeklyWindow(card({ windows: [{ name: 'Chat', unlimited: true }] }))?.unlimited).toBe(true)
    expect(weeklyWindow(card({ windows: [{ name: 'Chat', display: 'Unlimited' }] }))?.display).toBe('Unlimited')
    expect(weeklyWindow(card({ windows: [{ name: 'Chat' }] }))).toBeUndefined()
  })
})

describe('sidebarRows', () => {
  it('keeps gateway order and clamps readings', () => {
    const rows = sidebarRows([
      card({ provider: 'codex', windows: [{ name: '7 days', used: 120 }] }),
      card({ provider: 'claude', windows: [{ name: '7 days', used: -5 }] }),
    ])
    expect(rows.map(row => row.card.provider)).toEqual(['codex', 'claude'])
    expect(rows.map(row => row.used)).toEqual([100, 0])
  })

  it('marks a card with an error as failed and does not expose a reading', () => {
    const [row] = sidebarRows([card({ provider: 'codex', error: 'token expired', windows: [{ name: '7 days', used: 91 }] })])
    expect(row?.failed).toBe(true)
    expect(row?.card.error).toBe('token expired')
  })

  it('carries display and unlimited markers through', () => {
    const [row] = sidebarRows([card({ windows: [{ name: 'Chat', unlimited: true }] })])
    expect(row?.unlimited).toBe(true)
    expect(row?.used).toBeUndefined()
  })
})

describe('formatting', () => {
  it('formats percentages the way the settings page does', () => {
    expect(formatUsed(8)).toBe('8%')
    expect(formatUsed(70.5)).toBe('70.5%')
    expect(formatUsed(100)).toBe('100%')
  })

  it('reports whole minutes, clamped at zero, and ignores unparseable input', () => {
    const now = Date.parse('2026-11-03T16:17:01Z')
    expect(ageMinutes('2026-11-03T16:14:01Z', now)).toBe(3)
    expect(ageMinutes('2026-11-03T16:17:30Z', now)).toBe(0)
    expect(ageMinutes('not a date', now)).toBeUndefined()
    expect(ageMinutes(undefined, now)).toBeUndefined()
  })

  it('shortens the reset time by range', () => {
    const now = Date.parse('2026-11-03T10:00:00')
    expect(formatResetShort(new Date(2026, 10, 3, 19, 20).toISOString(), now)).toBe('19:20')
    expect(formatResetShort(new Date(2026, 10, 10, 11, 0).toISOString(), now)).toBe('11/10 11:00')
    expect(formatResetShort(new Date(2027, 0, 2, 9, 5).toISOString(), now)).toBe('2027/1/2 09:05')
    expect(formatResetShort('nope', now)).toBeUndefined()
    expect(formatResetShort(undefined, now)).toBeUndefined()
  })
})

describe('unchangedReads', () => {
  const a = card({ provider: 'claude', readAt: 'T1' })
  const b = card({ provider: 'codex', readAt: 'T2' })

  it('is true only when every card kept its read time', () => {
    expect(unchangedReads([a, b], [{ ...a }, { ...b }])).toBe(true)
    expect(unchangedReads([a, b], [{ ...a, readAt: 'T3' }, { ...b }])).toBe(false)
  })

  it('is false for a different card set or an empty result', () => {
    expect(unchangedReads([a, b], [a])).toBe(false)
    expect(unchangedReads([], [a])).toBe(false)
    expect(unchangedReads([a, b], [])).toBe(false)
  })
})
