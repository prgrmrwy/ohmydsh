/**
 * Concentric-ring geometry for the capability wheel.
 *
 * Pure functions with no DOM access, so the layout rules can be tested
 * directly rather than inferred from rendered output.
 *
 * The parameters are measured, not guessed. Widening a ring barely helps the
 * inner ring: its label sits on the band's midline, so the usable arc is
 * driven by ANGLE, not radius — going from a 38px to a 48px ring still yields
 * four characters. Pushing the first ring outward is what works, which is why
 * the breathing gap is 20px rather than a token few pixels.
 */

/** Ring capacities from the inside out; three rings cap the wheel at 24. */
export const RING_CAPACITIES = [6, 8, 10] as const

/** Total capabilities the wheel can show. */
export const WHEEL_CAPACITY = RING_CAPACITIES.reduce((sum, n) => sum + n, 0)

/** Radial thickness of one ring, in pixels. */
export const RING_WIDTH = 38

/** Clear space between the mascot and the first ring, in pixels. */
export const RING_GAP = 20

/** One rendered ring: how many slots it holds and where it sits. */
export interface WheelRing {
  /** Capabilities placed in this ring. */
  readonly count: number
  /** Inner radius in pixels, measured from the mascot's centre. */
  readonly innerRadius: number
  /** Outer radius in pixels. */
  readonly outerRadius: number
}

/**
 * Distribute capabilities across rings, filling each before opening the next.
 * @param total - Number of capabilities to place.
 * @param mascotSize - Mascot diameter in pixels.
 * @returns the rings to render, innermost first.
 */
export function planRings(total: number, mascotSize: number): readonly WheelRing[] {
  const rings: WheelRing[] = []
  // Anything past the ceiling is dropped rather than shown in a fourth ring:
  // that ring would be mostly off-screen and its slices too narrow for a
  // label. Dropping degrades the display; it never disables a Skill.
  let remaining = Math.max(0, Math.min(total, WHEEL_CAPACITY))
  for (const [index, capacity] of RING_CAPACITIES.entries()) {
    if (remaining <= 0) break
    const count = Math.min(remaining, capacity)
    const innerRadius = mascotSize / 2 + RING_GAP + index * RING_WIDTH
    rings.push({ count, innerRadius, outerRadius: innerRadius + RING_WIDTH })
    remaining -= count
  }
  return rings
}

/**
 * Radius of the disc that counts as "still on the wheel".
 *
 * Measured against the rings actually DRAWN. Using the three-ring maximum kept
 * the wheel open over blank space where later rings would be, so the
 * interactive area disagreed with what the user could see.
 * @param rings - Rings currently rendered.
 * @param mascotSize - Mascot diameter in pixels.
 * @returns the outer radius in pixels.
 */
export function hoverRadius(rings: readonly WheelRing[], mascotSize: number): number {
  const last = rings.at(-1)
  return last === undefined ? mascotSize / 2 : last.outerRadius
}

/** Where one capability sits on the wheel. */
export interface WheelSlot {
  /** Index into the capability list. */
  readonly index: number
  /** Zero-based ring, used to stagger the reveal. */
  readonly ring: number
  /** Annulus sector path, in a viewBox centred on `centre`. */
  readonly path: string
  /** Label anchor x, in the same viewBox. */
  readonly labelX: number
  /** Label anchor y. */
  readonly labelY: number
  /** Label rotation in degrees, already corrected to read upright. */
  readonly labelRotation: number
  /** Characters this slot's arc can show. */
  readonly labelCapacity: number
}

/**
 * Build one annulus sector path.
 *
 * A lone capability spans the full circle, where the standard two-point arc
 * degenerates to a dot; that case is drawn as two half-circles instead.
 * @param centre - ViewBox centre coordinate.
 * @param inner - Inner radius.
 * @param outer - Outer radius.
 * @param startAngle - Start angle in degrees, 0 = east.
 * @param endAngle - End angle in degrees.
 * @returns the SVG path data.
 */
export function sectorPath(
  centre: number,
  inner: number,
  outer: number,
  startAngle: number,
  endAngle: number,
): string {
  if (endAngle - startAngle >= 359.9) {
    return (
      `M${centre - outer} ${centre} A${outer} ${outer} 0 1 1 ${centre + outer} ${centre} ` +
      `A${outer} ${outer} 0 1 1 ${centre - outer} ${centre} Z ` +
      `M${centre - inner} ${centre} A${inner} ${inner} 0 1 0 ${centre + inner} ${centre} ` +
      `A${inner} ${inner} 0 1 0 ${centre - inner} ${centre} Z`
    )
  }
  const point = (radius: number, angle: number): readonly [number, number] => [
    centre + radius * Math.cos((angle * Math.PI) / 180),
    centre + radius * Math.sin((angle * Math.PI) / 180),
  ]
  const [x0, y0] = point(outer, startAngle)
  const [x1, y1] = point(outer, endAngle)
  const [x2, y2] = point(inner, endAngle)
  const [x3, y3] = point(inner, startAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return (
    `M${x0} ${y0} A${outer} ${outer} 0 ${large} 1 ${x1} ${y1} ` +
    `L${x2} ${y2} A${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`
  )
}

/**
 * Rotate a label to follow the arc without ever reading upside-down.
 *
 * Tangential alignment alone inverts every slice below the horizon, so any
 * angle that would render inverted is flipped a further 180°. The bottom
 * sector therefore reads fully upright.
 * @param midAngle - Sector's mid-angle in degrees, 0 = east.
 * @returns the rotation in degrees.
 */
export function labelRotation(midAngle: number): number {
  const tangential = midAngle + 90
  const normalized = ((tangential % 360) + 360) % 360
  return normalized > 90 && normalized < 270 ? tangential + 180 : tangential
}

/**
 * Place every capability on the wheel.
 * @param total - Number of capabilities.
 * @param mascotSize - Mascot diameter in pixels.
 * @param centre - ViewBox centre coordinate.
 * @returns one slot per rendered capability.
 */
export function planSlots(
  total: number,
  mascotSize: number,
  centre: number,
): readonly WheelSlot[] {
  const slots: WheelSlot[] = []
  let index = 0
  for (const [ring, { count, innerRadius, outerRadius }] of planRings(total, mascotSize).entries()) {
    const step = 360 / count
    const midRadius = (innerRadius + outerRadius) / 2
    for (let position = 0; position < count; position += 1) {
      // Start at the top so the first capability is where the eye lands.
      const startAngle = -90 + position * step
      const midAngle = startAngle + step / 2
      slots.push({
        index,
        ring,
        path: sectorPath(centre, innerRadius, outerRadius, startAngle, startAngle + step),
        labelX: centre + midRadius * Math.cos((midAngle * Math.PI) / 180),
        labelY: centre + midRadius * Math.sin((midAngle * Math.PI) / 180),
        labelRotation: labelRotation(midAngle),
        // One character of padding keeps the text off the slice edges.
        labelCapacity: Math.max(2, Math.floor(((2 * Math.PI * midRadius) / count - 12) / 12)),
      })
      index += 1
    }
  }
  return slots
}

/**
 * Shorten a label to what its slice can actually show.
 * @param text - Full label.
 * @param capacity - Characters the arc can hold.
 * @returns the label to render.
 */
export function fitLabel(text: string, capacity: number): string {
  const characters = [...text]
  if (characters.length <= capacity) return text
  return `${characters.slice(0, Math.max(1, capacity - 1)).join('')}…`
}
