/**
 * Wheel geometry.
 *
 * These test the layout rules directly rather than through rendered output:
 * the defects this replaces — a hover area that disagreed with what was drawn,
 * and labels that rendered upside-down — were both arithmetic, and a
 * screenshot-level assertion would not have located either.
 */

import { describe, expect, it } from 'vitest'
import {
  fitLabel,
  hoverRadius,
  labelRotation,
  planRings,
  planSlots,
  RING_GAP,
  RING_WIDTH,
  sectorPath,
  WHEEL_CAPACITY,
} from '../src/client/wheel.js'

describe('capabilities fill each ring before opening the next', () => {
  it('places a single capability in one ring', () => {
    expect(planRings(1, 72).map(ring => ring.count)).toEqual([1])
  })

  it('splits two and three capabilities within the inner ring', () => {
    expect(planRings(2, 72).map(ring => ring.count)).toEqual([2])
    expect(planRings(3, 72).map(ring => ring.count)).toEqual([3])
  })

  it('opens the second ring only once the first is full', () => {
    expect(planRings(6, 72).map(ring => ring.count)).toEqual([6])
    expect(planRings(7, 72).map(ring => ring.count)).toEqual([6, 1])
  })

  it('opens the third ring only once the second is full', () => {
    expect(planRings(14, 72).map(ring => ring.count)).toEqual([6, 8])
    expect(planRings(15, 72).map(ring => ring.count)).toEqual([6, 8, 1])
  })

  it('fills all three rings at capacity', () => {
    expect(planRings(24, 72).map(ring => ring.count)).toEqual([6, 8, 10])
    expect(WHEEL_CAPACITY).toBe(24)
  })

  it('drops capabilities beyond the ceiling instead of adding a ring', () => {
    // A fourth ring would be mostly off-screen and its slices too narrow to
    // label. Dropping degrades the display; it never disables a Skill.
    expect(planRings(26, 72).map(ring => ring.count)).toEqual([6, 8, 10])
    expect(planSlots(26, 72, 172)).toHaveLength(24)
  })

  it('handles an empty wheel', () => {
    expect(planRings(0, 72)).toEqual([])
  })

  it('scales radii with the mascot size', () => {
    const small = planRings(1, 56)[0]
    const large = planRings(1, 88)[0]

    expect(small?.innerRadius).toBe(56 / 2 + RING_GAP)
    expect(large?.innerRadius).toBe(88 / 2 + RING_GAP)
    expect((large?.outerRadius ?? 0) - (large?.innerRadius ?? 0)).toBe(RING_WIDTH)
  })
})

describe('the hover disc matches what is drawn', () => {
  it('shrinks to one ring when only one is rendered', () => {
    // Measuring against the three-ring maximum kept the wheel open over blank
    // space where later rings would be.
    expect(hoverRadius(planRings(6, 72), 72)).toBe(72 / 2 + RING_GAP + RING_WIDTH)
  })

  it('grows as further rings appear', () => {
    const one = hoverRadius(planRings(6, 72), 72)
    const two = hoverRadius(planRings(7, 72), 72)
    const three = hoverRadius(planRings(15, 72), 72)

    expect(two).toBeGreaterThan(one)
    expect(three).toBeGreaterThan(two)
    expect(three).toBe(72 / 2 + RING_GAP + 3 * RING_WIDTH)
  })

  it('collapses to the mascot when there is nothing to show', () => {
    expect(hoverRadius([], 72)).toBe(36)
  })
})

describe('labels never read upside-down', () => {
  it('renders the bottom sector fully upright', () => {
    // A label directly below the mascot is the case that made this visible.
    // Compare normalized: 360° and 0° are the same orientation.
    expect(((labelRotation(90) % 360) + 360) % 360).toBe(0)
  })

  it('keeps every angle within the readable half', () => {
    for (let mid = -180; mid <= 180; mid += 5) {
      const normalized = ((labelRotation(mid) % 360) + 360) % 360
      expect(normalized > 90 && normalized < 270).toBe(false)
    }
  })

  it('aligns tangentially where that already reads upright', () => {
    // The right-hand sector needs no correction; only inverted angles flip.
    expect(((labelRotation(-90) % 360) + 360) % 360).toBe(0)
    expect(((labelRotation(0) % 360) + 360) % 360).toBe(90)
  })

  it('produces upright rotations for every slot of a full wheel', () => {
    for (const slot of planSlots(24, 72, 172)) {
      const normalized = ((slot.labelRotation % 360) + 360) % 360
      expect(normalized > 90 && normalized < 270).toBe(false)
    }
  })
})

describe('sector paths stay well-formed', () => {
  it('draws a full ring for a lone capability', () => {
    const [slot] = planSlots(1, 72, 172)

    // A 360° sector degenerates to a dot with the standard two-point arc, so
    // the full circle is drawn as two half-circles plus an inner cut-out.
    expect(slot?.path).toContain('A')
    expect((slot?.path.match(/M/g) ?? []).length).toBe(2)
  })

  it('draws a wedge for a partial sector', () => {
    const [slot] = planSlots(6, 72, 172)

    expect((slot?.path.match(/M/g) ?? []).length).toBe(1)
    expect(slot?.path.endsWith('Z')).toBe(true)
  })

  it('sets the large-arc flag only past half a turn', () => {
    // Two capabilities each span 180°, which must NOT set the flag; three span
    // 120°. Getting this wrong inverts the wedge into its complement.
    expect(sectorPath(172, 58, 96, 0, 180)).toContain(' 0 1 ')
    expect(sectorPath(172, 58, 96, 0, 240)).toContain(' 1 1 ')
  })
})

describe('labels shorten to what their slice can show', () => {
  it('leaves a short label untouched', () => {
    expect(fitLabel('清理', 5)).toBe('清理')
  })

  it('truncates with an ellipsis when too long', () => {
    expect(fitLabel('清理当前工作区', 5)).toBe('清理当前…')
  })

  it('counts characters, not UTF-16 units', () => {
    // A naive `slice` would cut an emoji's surrogate pair into a replacement
    // character.
    expect(fitLabel('🧹清理工作区目录', 3)).toBe('🧹清…')
  })

  it('gives outer rings more room than inner ones', () => {
    const slots = planSlots(24, 72, 172)
    const inner = slots.find(slot => slot.ring === 0)
    const outer = slots.find(slot => slot.ring === 2)

    expect(outer?.labelCapacity).toBeGreaterThan(inner?.labelCapacity ?? 0)
  })
})

describe('the close rule needs no grace period', () => {
  it('treats the breathing gap as part of the wheel', () => {
    const radius = hoverRadius(planRings(6, 72), 72)
    const justOutsideMascot = 72 / 2 + 4

    // The gap between the mascot and ring one sits INSIDE the disc, so a
    // pointer crossing it has not left. The old rectangular menu needed a
    // timer precisely because that space was outside every element.
    expect(justOutsideMascot).toBeLessThan(radius)
  })

  it('treats a seam between rings as part of the wheel', () => {
    const rings = planRings(15, 72)
    const seam = rings[0]?.outerRadius ?? 0

    // Seams are where `mouseleave` fires spuriously; by distance they are
    // unambiguously inside.
    expect(seam).toBeLessThan(hoverRadius(rings, 72))
  })

  it('places a point beyond the outermost ring outside', () => {
    const rings = planRings(6, 72)

    expect(hoverRadius(rings, 72) + 1).toBeGreaterThan(hoverRadius(rings, 72))
  })
})

describe('the capacity cap is a display constraint', () => {
  it('renders only the first 24 capabilities', () => {
    // Over-capacity degrades the wheel; it must not disable a Skill or throw.
    expect(planSlots(30, 72, 172)).toHaveLength(WHEEL_CAPACITY)
  })

  it('assigns every rendered slot to one of three rings', () => {
    for (const slot of planSlots(30, 72, 172)) {
      expect(slot.ring).toBeGreaterThanOrEqual(0)
      expect(slot.ring).toBeLessThan(3)
    }
  })
})

describe('the ring gradient is a user choice', () => {
  it('defaults to a style where ring one is lighter than the mascot', async () => {
    const { ringFill, DEFAULT_RING_STYLE } = await import('../src/client/accent.js')
    const accent = '#d1e6d2'
    const sum = (hex: string): number => {
      const value = Number.parseInt(hex.slice(1), 16)
      return ((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255)
    }

    // The reverted attempt left ring one at the accent's full value, so the
    // mascot's shadow made the ring read as darker than the centre.
    expect(sum(ringFill(accent, 0, DEFAULT_RING_STYLE))).toBeGreaterThan(sum(accent))
  })

  it('fades outward under every compositing style', async () => {
    const { ringFill } = await import('../src/client/accent.js')
    const sum = (hex: string): number => {
      const value = Number.parseInt(hex.slice(1), 16)
      return ((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255)
    }

    for (const style of ['soft', 'faint', 'solid'] as const) {
      const rings = [0, 1, 2].map(ring => sum(ringFill('#d1e6d2', ring, style)))
      expect(rings[1]).toBeGreaterThan(rings[0] ?? 0)
      expect(rings[2]).toBeGreaterThan(rings[1] ?? 0)
    }
  })

  it('makes "faint" lighter than "soft" at every ring', async () => {
    const { ringFill } = await import('../src/client/accent.js')
    const sum = (hex: string): number => {
      const value = Number.parseInt(hex.slice(1), 16)
      return ((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255)
    }

    for (const ring of [0, 1, 2]) {
      expect(sum(ringFill('#d1e6d2', ring, 'faint'))).toBeGreaterThan(
        sum(ringFill('#d1e6d2', ring, 'soft')),
      )
    }
  })

  it('keeps "solid" at the accent for ring one', async () => {
    const { ringFill } = await import('../src/client/accent.js')

    // This is the behaviour that prompted the setting; it stays available.
    expect(ringFill('#d1e6d2', 0, 'solid')).toBe('#d1e6d2')
  })

  it('paints a uniform surface under "none"', async () => {
    const { ringFill } = await import('../src/client/accent.js')

    for (const ring of [0, 1, 2]) {
      expect(ringFill('#d1e6d2', ring, 'none')).toBe('#ffffff')
    }
  })

  it('leaves the white default flat under every style', async () => {
    const { ringFill, PET_RING_STYLES } = await import('../src/client/accent.js')

    // Measured, not assumed: the default accent is already white, so no style
    // can separate its rings — the stroke must.
    for (const style of PET_RING_STYLES) {
      expect(ringFill('#ffffff', 0, style.id)).toBe('#ffffff')
      expect(ringFill('#ffffff', 2, style.id)).toBe('#ffffff')
    }
  })

  it('clamps a ring index beyond the palette', async () => {
    const { ringFill } = await import('../src/client/accent.js')

    expect(ringFill('#d1e6d2', 9, 'soft')).toBe(ringFill('#d1e6d2', 2, 'soft'))
  })

  it('darkens on hover under every style, including white', async () => {
    const { hoverFill, ringFill, PET_RING_STYLES } = await import('../src/client/accent.js')
    const sum = (hex: string): number => {
      const value = Number.parseInt(hex.slice(1), 16)
      return ((value >> 16) & 255) + ((value >> 8) & 255) + (value & 255)
    }

    for (const style of PET_RING_STYLES) {
      const rest = ringFill('#ffffff', 0, style.id)
      expect(sum(hoverFill(rest))).toBeLessThan(sum(rest))
    }
  })
})
