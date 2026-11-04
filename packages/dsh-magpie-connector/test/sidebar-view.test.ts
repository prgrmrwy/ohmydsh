import { describe, expect, it } from 'vitest'
import {
  ageMinutes, formatResetDeadline, formatResetShort, formatUsed, sidebarRows, unchangedReads, usedLevel,
} from '../src/client/sidebar-view.js'
import type { Card } from '../src/client/view-model.js'

const card = (overrides: Partial<Card>): Card => ({ provider: 'claude', ...overrides })

describe('usedLevel', () => {
  it.each([[0, 'normal'], [70, 'normal'], [70.5, 'warn'], [89.9, 'warn'], [90, 'high'], [100, 'high']] as const)('%s%% → %s', (used, level) => {
    expect(usedLevel(used)).toBe(level)
  })
})

describe('sidebarRows', () => {
  it('keeps gateway order and clamps readings', () => {
    const rows = sidebarRows([
      card({ provider: 'codex', windows: [{ name: '7 days', used: 120 }] }),
      card({ provider: 'claude', windows: [{ name: '7 days', used: -5 }] }),
    ])
    expect(rows.map(row => row!.card.provider)).toEqual(['codex', 'claude'])
    expect(rows.map(row => row!.windows[0]?.used)).toEqual([100, 0])
  })

  it('shows only the weekly window by default, never the short one', () => {
    const [row] = sidebarRows([card({ windows: [{ name: '5 hours', used: 90 }, { name: '7 days', used: 8 }] })])
    expect(row!.windows.map(entry => entry.window.name)).toEqual(['7 days'])
    expect(row!.windows[0]?.kind).toBe('weekly')
    expect(row!.windows[0]?.used).toBe(8)
    expect(row!.windows[0]?.fallback).toBeUndefined()
  })

  it('takes the highest used weekly window when several exist', () => {
    const [row] = sidebarRows([card({ windows: [{ name: '7 days', used: 8 }, { name: '7 days · Fable', used: 5 }] })])
    expect(row!.windows[0]?.used).toBe(8)
  })

  it('accepts the other weekly spellings the gateway may use', () => {
    for (const name of ['weekly', 'Week', '每周', '7 day']) {
      const [row] = sidebarRows([card({ windows: [{ name, used: 12 }] })])
      expect(row!.windows[0]?.used).toBe(12)
    }
  })

  it('lists the 5-hour window before the weekly one when both are selected', () => {
    const [row] = sidebarRows(
      [card({ windows: [{ name: '7 days', used: 20 }, { name: '5 hours', used: 44 }] })],
      ['weekly', 'fiveHour'],
    )
    expect(row!.windows.map(entry => [entry.kind, entry.window.name, entry.used])).toEqual([
      ['fiveHour', '5 hours', 44],
      ['weekly', '7 days', 20],
    ])
    expect(row!.windows.every(entry => entry.fallback === undefined)).toBe(true)
  })

  it('lists three window lines in canonical order when all kinds are selected', () => {
    const [row] = sidebarRows(
      [card({ windows: [{ name: '30 days', used: 61 }, { name: '7 days', used: 20 }, { name: '5 hours', used: 44 }] })],
      ['monthly', 'weekly', 'fiveHour'],
    )
    expect(row!.windows.map(entry => [entry.kind, entry.window.name, entry.used])).toEqual([
      ['fiveHour', '5 hours', 44],
      ['weekly', '7 days', 20],
      ['monthly', '30 days', 61],
    ])
  })

  it('recognizes the monthly spellings the gateway may use', () => {
    for (const name of ['monthly', 'Month', '30 days', '每月']) {
      const [row] = sidebarRows([card({ windows: [{ name, used: 61 }] })], ['monthly'])
      expect(row!.windows[0]?.kind).toBe('monthly')
      expect(row!.windows[0]?.used).toBe(61)
    }
  })

  it('recognizes the 5-hour spellings the gateway may use', () => {
    for (const name of ['5 hours', '5-hour', '5h', '五小时']) {
      const [row] = sidebarRows([card({ windows: [{ name, used: 44 }] })], ['fiveHour'])
      expect(row!.windows[0]?.kind).toBe('fiveHour')
      expect(row!.windows[0]?.used).toBe(44)
    }
  })

  it('falls back to the highest numeric window when no selected kind exists', () => {
    const [row] = sidebarRows([card({ windows: [{ name: '5 hours', used: 44 }, { name: 'daily', used: 66 }] })], ['weekly'])
    expect(row!.windows).toHaveLength(1)
    expect(row!.windows[0]).toMatchObject({ kind: 'other', used: 66, fallback: true })
    expect(row!.windows[0]?.window.name).toBe('daily')
  })

  it('falls back to a display/unlimited window when nothing is numeric', () => {
    expect(sidebarRows([card({ windows: [{ name: 'Chat', unlimited: true }] })])[0]?.windows[0]).toMatchObject({ kind: 'other', unlimited: true, fallback: true })
    expect(sidebarRows([card({ windows: [{ name: 'Chat', display: 'Unlimited' }] })])[0]?.windows[0]).toMatchObject({ kind: 'other', display: 'Unlimited' })
    expect(sidebarRows([card({ windows: [{ name: 'Chat' }] })])[0]?.windows).toEqual([])
  })

  it('never lists the same window twice when one name matches both kinds', () => {
    const [row] = sidebarRows([card({ windows: [{ name: '5 hours weekly', used: 30 }] })], ['fiveHour', 'weekly'])
    expect(row!.windows).toHaveLength(1)
  })

  it('marks a card with an error as failed and exposes no windows', () => {
    const row = sidebarRows([card({ provider: 'codex', error: 'token expired', windows: [{ name: '7 days', used: 91 }] })])[0]!
    expect(row!.failed).toBe(true)
    expect(row!.windows).toEqual([])
    expect(row!.card.error).toBe('token expired')
  })

  it('carries the balance of a balance-only account', () => {
    const row = sidebarRows([card({ provider: 'deepseek', balance: '¥42.50' })])[0]!
    expect(row!.windows).toEqual([])
    expect(row!.balance).toBe('¥42.50')
  })

  it('omits empty balances', () => {
    expect(sidebarRows([card({ balance: '' })])[0]?.balance).toBeUndefined()
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

  it('always keeps a date on the compact-row reset label', () => {
    const now = Date.parse('2026-11-03T10:00:00')
    expect(formatResetDeadline(new Date(2026, 10, 3, 19, 20).toISOString(), now)).toBe('11/3 19:20')
    expect(formatResetDeadline(new Date(2026, 10, 20, 11, 0).toISOString(), now)).toBe('11/20 11:00')
    expect(formatResetDeadline(new Date(2027, 0, 2, 9, 5).toISOString(), now)).toBe('2027/1/2 09:05')
    expect(formatResetDeadline('nope', now)).toBeUndefined()
    expect(formatResetDeadline('', now)).toBeUndefined()
    expect(formatResetDeadline(undefined, now)).toBeUndefined()
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
