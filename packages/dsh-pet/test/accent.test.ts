/**
 * Mascot accent palette.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GLYPH,
  DEFAULT_SIZE_PX,
  PET_ACCENTS,
  resolveAccent,
  normalizeGlyph,
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

  it('keeps every colour below 45% saturation', () => {
    // The mascot floats above real work for the whole session, so a vivid paw
    // would compete with the content underneath it.
    for (const accent of PET_ACCENTS) {
      expect(saturation(accent.background)).toBeLessThanOrEqual(0.45)
    }
  })

  it('tints the surface, because CSS cannot recolour a colour emoji', async () => {
    const { readFile } = await import('node:fs/promises')
    const path = await import('node:path')
    const overlay = await readFile(
      path.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The default glyph has Emoji_Presentation, so fonts render it as a
    // colour bitmap and CSS `color` silently does nothing. Colouring the
    // circle is the only approach that works for any glyph.
    expect(/\p{Emoji_Presentation}/u.test('🐾')).toBe(true)
    // The tinted circle belongs to glyph mode only; an imported Lottie paints
    // its own transparent artwork, so the surface becomes transparent.
    expect(overlay).toContain("'transparent' : accent.background")
  })
})

describe('the accent survives a bad stored value', () => {
  it('falls back to the default for an unknown id', () => {
    // A palette entry removed in a later release must not blank the mascot.
    expect(resolveAccent('chartreuse').id).toBe('default')
  })


  it('resolves an absent value to the default', () => {
    expect(resolveAccent(undefined).id).toBe('default')
  })
})


describe('the size is bounded and keeps Pet reachable', () => {


  it('clamps against the ACTUAL size, not a fixed constant', async () => {
    const { clampPosition } = await import('../src/client/position.js')

    // Clamping a large mascot against the default constant would leave it
    // partly off-screen and unclickable.
    const viewport = { width: 500, height: 400 }
    expect(clampPosition({ x: 999, y: 999 }, viewport, 88)).toEqual({ x: 412, y: 312 })
    expect(clampPosition({ x: 999, y: 999 }, viewport, 56)).toEqual({ x: 444, y: 344 })
  })
})

describe('appearance survives a restart', () => {
  it('keeps a small mascot where the user dropped it', async () => {
    const { readPosition, resolvePosition, writePosition } = await import('../src/client/position.js')
    const viewport = { width: 1000, height: 800 }

    // A 56px mascot may sit up to 944/744; the 72px default caps at 928/728.
    writePosition({ x: 940, y: 740 }, viewport, globalThis.localStorage, 56)

    // The saved anchor is stored verbatim, and the render clamps it against
    // the ACTUAL size, so nothing pulls the small mascot back on reload.
    const anchor = readPosition(globalThis.localStorage)
    expect(anchor).toEqual({ x: 940, y: 740 })
    expect(resolvePosition(anchor, viewport, 56)).toEqual({ x: 940, y: 740 })
    // Clamping it as if it were the 72px default is exactly the old drift.
    expect(resolvePosition(anchor, viewport, 72)).toEqual({ x: 928, y: 728 })
  })

  it('does not drift across repeated restarts', async () => {
    const { readPosition, resolvePosition, writePosition } = await import('../src/client/position.js')
    const viewport = { width: 1000, height: 800 }
    writePosition({ x: 940, y: 740 }, viewport, globalThis.localStorage, 56)

    const first = resolvePosition(readPosition(globalThis.localStorage), viewport, 56)
    const second = resolvePosition(readPosition(globalThis.localStorage), viewport, 56)

    expect(second).toEqual(first)
    expect(first).toEqual({ x: 940, y: 740 })
  })
})

describe('the overlay measures one stable box before placing Pet', () => {
  it('seeds and re-reads the viewport from the same source', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const overlay = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // Seeding from one box and correcting to another in an effect clamps the
    // stored position against a LARGER box first and a smaller one after,
    // nudging Pet up and left on every load. Reusing a single `read()` for
    // both the initial state and the resize handler makes that impossible.
    expect(overlay).toContain('const [viewport, setViewport] = useState(read)')
    // The frame is no longer QUERIED: it shrinks with a layout-push sidebar,
    // and clamping to it would drag Pet aside as the panel opens. (Prose may
    // still mention the old layer to explain why it was dropped.)
    expect(overlay).not.toMatch(/querySelector\([^)]*data-shell-overlay/)
  })

  it('never persists a position that only re-clamping produced', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const overlay = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // A temporary narrow layout must not overwrite the user's chosen spot.
    expect([...overlay.matchAll(/writePosition\(/g)]).toHaveLength(1)
  })

  it('renders from the saved anchor instead of clamping it into state', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const overlay = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    // The position handed to `transform` is derived per render from the saved
    // anchor. Storing the clamped value instead is what made a viewport that
    // was still settling at mount (an iframe measuring 0x0) permanently move
    // Pet: nothing ever restored the saved spot when the real viewport arrived.
    expect(overlay).toContain('resolvePosition(anchor, viewport, size)')
    expect(overlay).not.toContain('setPosition(')
  })
})

describe('glyph normalization is pure, so the Host can store the result', () => {
  it('keeps only the first user-perceived character', () => {
    expect(normalizeGlyph('🐾🐱🐶')).toBe('🐾')
  })

  it('keeps a composed emoji whole', () => {
    // 👩‍💻 is three code points and 👨‍👩‍👧 is five, yet each is ONE glyph.
    expect(normalizeGlyph('👩‍💻')).toBe('👩‍💻')
    expect(normalizeGlyph('👨‍👩‍👧')).toBe('👨‍👩‍👧')
    expect(normalizeGlyph('🇨🇳')).toBe('🇨🇳')
  })

  it('returns empty for blank input, which restores the default', () => {
    expect(normalizeGlyph('   ')).toBe('')
  })
})

describe('settings persist Host-side, position stays local', () => {
  it('exposes no localStorage writer for the configured appearance', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const settings = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'client', 'settings.tsx'),
      'utf8',
    )

    // The plugin runtime has no usable `localStorage`: writes there are lost,
    // which is why accent, glyph and size reset on every restart.
    expect(settings).not.toContain('writeAccent(')
    expect(settings).not.toContain('writeGlyph(')
    expect(settings).not.toContain('writeSize(')
    expect(settings).toContain('updateConfig({ appearance:')
  })

  it('keeps position in localStorage, because dragging is not a setting', async () => {
    const { readFile } = await import('node:fs/promises')
    const nodePath = await import('node:path')
    const overlay = await readFile(
      nodePath.resolve(process.cwd(), 'src', 'client', 'overlay.tsx'),
      'utf8',
    )

    expect(overlay).toContain('writePosition(')
    expect(overlay).toContain('globalThis.localStorage')
  })
})
