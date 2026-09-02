/**
 * Mascot accent palette.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  ACCENT_KEY,
  DEFAULT_GLYPH,
  DEFAULT_SIZE_PX,
  PET_ACCENTS,
  SIZE_KEY,
  readAccent,
  readGlyph,
  readSize,
  resolveAccent,
  writeAccent,
  writeGlyph,
  writeSize,
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
  it('offers the eight requested colours plus a default', () => {
    expect(PET_ACCENTS).toHaveLength(9)
    expect(PET_ACCENTS.map(a => a.id)).toEqual([
      'default',
      'black',
      'red',
      'orange',
      'yellow',
      'green',
      'cyan',
      'blue',
      'purple',
    ])
  })

  it('keeps every colour below 45% saturation', () => {
    // The mascot floats above real work for the whole session, so a vivid paw
    // would compete with the content underneath it.
    for (const accent of PET_ACCENTS) {
      expect(saturation(accent.glyph)).toBeLessThanOrEqual(0.45)
    }
  })

  it('keeps the paw readable against the panel surface', () => {
    // The accent colours the PAW, not the surface, so contrast is measured
    // against the neutral panel background the mascot sits on.
    for (const accent of PET_ACCENTS) {
      const [hi, lo] = [luminance('#ffffff'), luminance(accent.glyph)].sort(
        (a, b) => b - a,
      ) as [number, number]
      // WCAG AA for large text; the glyph is 38px.
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('tints only the paw, never the surface', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const overlay = await readFile(
      path.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Tinting the circle would make Pet read as a status badge, and would
    // leave no room for a black option — black is a paw colour, not a
    // backdrop.
    expect(overlay).toContain('color: accent.glyph')
    expect(overlay).not.toContain('background: accent.')
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

describe('the glyph is user-chosen but always renderable', () => {
  it('falls back to the default when cleared', () => {
    writeGlyph('   ')

    // A blank glyph would render an invisible mascot the user could no longer
    // click, stranding Pet on the page.
    expect(readGlyph()).toBe(DEFAULT_GLYPH)
  })

  it('accepts an arbitrary emoji, not just the suggestions', () => {
    writeGlyph('🦖')
    expect(readGlyph()).toBe('🦖')
  })

  it('keeps only the first character', () => {
    writeGlyph('🐾🐱🐶')
    expect(readGlyph()).toBe('🐾')
  })

  it('keeps a composed emoji whole rather than cutting it apart', () => {
    // 👩‍💻 is three code points and 👨‍👩‍👧 is five, yet each is ONE visible
    // glyph. Counting code points would slice them into fragments that render
    // as separate figures or replacement characters.
    writeGlyph('👩‍💻')
    expect(readGlyph()).toBe('👩‍💻')

    writeGlyph('👨‍👩‍👧')
    expect(readGlyph()).toBe('👨‍👩‍👧')
  })

  it('keeps a flag emoji whole', () => {
    // Regional indicator pairs are two code points forming one glyph.
    writeGlyph('🇨🇳')
    expect(readGlyph()).toBe('🇨🇳')
  })

  it('truncates a composed emoji followed by more input', () => {
    writeGlyph('👩‍💻🐾')
    expect(readGlyph()).toBe('👩‍💻')
  })
})

describe('the size is bounded and keeps Pet reachable', () => {
  it('falls back to the default for an unknown value', () => {
    globalThis.localStorage.setItem(SIZE_KEY, 'enormous')
    expect(readSize()).toBe(DEFAULT_SIZE_PX)
  })

  it('reads back a chosen size', () => {
    writeSize('large')
    expect(readSize()).toBe(88)
  })

  it('clamps against the ACTUAL size, not a fixed constant', async () => {
    const { clampPosition } = await import('../src/client/position.js')

    // Clamping a large mascot against the default constant would leave it
    // partly off-screen and unclickable.
    const viewport = { width: 500, height: 400 }
    expect(clampPosition({ x: 999, y: 999 }, viewport, 88)).toEqual({ x: 412, y: 312 })
    expect(clampPosition({ x: 999, y: 999 }, viewport, 56)).toEqual({ x: 444, y: 344 })
  })
})
