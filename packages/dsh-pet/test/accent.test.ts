/**
 * Mascot accent palette.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  ACCENT_KEY,
  PET_ACCENTS,
  readAccent,
  resolveAccent,
  writeAccent,
} from '../src/client/accent.js'

afterEach(() => {
  globalThis.localStorage?.clear()
})

/** Parse `#rrggbb` into 0..1 channels. */
function channels(hex: string): [number, number, number] {
  const v = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(c =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** HSL saturation. */
function saturation(hex: string): number {
  const [r, g, b] = channels(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const l = (max + min) / 2
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

describe('the palette is muted by construction', () => {
  it('offers the seven requested hues plus a default', () => {
    expect(PET_ACCENTS).toHaveLength(8)
    expect(PET_ACCENTS.map(a => a.id)).toEqual([
      'default',
      'red',
      'orange',
      'yellow',
      'green',
      'cyan',
      'blue',
      'purple',
    ])
  })

  it('keeps every hue below 45% saturation', () => {
    // The mascot floats above real work for the whole session, so a vivid
    // badge would compete with the content underneath it.
    for (const accent of PET_ACCENTS) {
      expect(saturation(accent.background)).toBeLessThanOrEqual(0.45)
    }
  })

  it('keeps the glyph readable on every background', () => {
    for (const accent of PET_ACCENTS) {
      const [hi, lo] = [luminance(accent.background), luminance(accent.foreground)].sort(
        (a, b) => b - a,
      ) as [number, number]
      // WCAG AA for large text; the glyph is 38px.
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the accent survives a bad stored value', () => {
  it('falls back to the default for an unknown id', () => {
    globalThis.localStorage.setItem(ACCENT_KEY, 'chartreuse')

    // A corrupt preference must never stop the mascot from rendering.
    expect(readAccent().id).toBe('default')
  })

  it('reads back what was written', () => {
    writeAccent('cyan')
    expect(readAccent().id).toBe('cyan')
  })

  it('resolves an absent value to the default', () => {
    expect(resolveAccent(undefined).id).toBe('default')
  })
})
