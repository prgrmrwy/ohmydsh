/**
 * Pet mascot accent colour.
 *
 * Persisted in the Host config file, not `localStorage`: anything the
 * Settings panel can change is configuration. Only the drag position stays
 * per-browser, because that is display state rather than a setting.
 *
 * The palette is deliberately desaturated. The mascot sits above real work
 * for the whole session, so a vivid badge would compete with the content it
 * floats over. Every entry is generated at a single HSL saturation (30%) and
 * lightness (86%), which keeps the seven hues consistent with each other and
 * holds glyph contrast above the 4.5:1 readability threshold.
 */

/** Event announcing that the accent changed. */
export const PET_ACCENT_EVENT = 'dsh-pet:accent-changed'

/** Identifier of one palette entry. */
export type PetAccentId =
  | 'default'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'

/** One selectable accent. */
export interface PetAccent {
  readonly id: PetAccentId
  readonly label: string
  /**
   * Mascot surface colour.
   *
   * Tinting the SURFACE rather than the glyph is forced by the glyph itself:
   * the default 🐾 has Emoji_Presentation, so fonts render it as a colour
   * bitmap and CSS `color` has no effect on it. Colouring the circle is the
   * only approach that works for every glyph a user might choose.
   */
  readonly background: string
}

/**
 * The selectable palette.
 *
 * Saturation is kept low on purpose: each entry is a soft tint rather than a
 * primary, so the mascot reads as part of the surface instead of an alert.
 */
export const PET_ACCENTS: readonly PetAccent[] = [
  { id: 'default', label: '默认', background: '#ffffff' },
  { id: 'red', label: '红', background: '#e6d4d1' },
  { id: 'orange', label: '橙', background: '#e6dbd1' },
  { id: 'yellow', label: '黄', background: '#e6e2d1' },
  { id: 'green', label: '绿', background: '#d1e6d2' },
  { id: 'cyan', label: '青', background: '#d1e4e6' },
  { id: 'blue', label: '蓝', background: '#d1dae6' },
  { id: 'purple', label: '紫', background: '#dbd1e6' },
]

/**
 * Resolve an accent id to its palette entry.
 * @param id - Stored identifier, possibly unknown.
 * @returns the matching accent, falling back to the default.
 */
/**
 * Fade an accent outward, one step per ring.
 *
 * Mixes toward white so outer rings recede and the eye lands on ring one,
 * where the most-used capability sits. The default accent is already white, so
 * the fade is invisible there — ring separation therefore relies on the stroke,
 * never on this gradient alone.
 * @param background - The accent's surface colour.
 * @param ring - Zero-based ring index.
 * @returns the fill for that ring.
 */
export function ringFill(background: string, ring: number): string {
  const RING_FADE = [0, 0.45, 0.75] as const
  const amount = RING_FADE[Math.min(ring, RING_FADE.length - 1)] ?? 0
  if (amount === 0) return background
  const value = Number.parseInt(background.slice(1), 16)
  if (!Number.isFinite(value)) return background
  const channel = (shift: number): number => {
    const base = (value >> shift) & 255
    return Math.round(base + (255 - base) * amount)
  }
  return `#${[channel(16), channel(8), channel(0)]
    .map(part => part.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Deepen a ring fill to mark the slice under the pointer.
 *
 * Applied inline for the same reason as the fill itself: an inline fill wins
 * over a class rule, so a CSS-only hover state would silently never appear.
 * @param fill - The ring's resting colour.
 * @returns the hovered colour.
 */
export function hoverFill(fill: string): string {
  const value = Number.parseInt(fill.slice(1), 16)
  if (!Number.isFinite(value)) return fill
  // Toward black, not a fixed grey: a fixed tint would wash out on dark
  // accents and overpower pale ones.
  const channel = (shift: number): number => Math.round(((value >> shift) & 255) * 0.92)
  return `#${[channel(16), channel(8), channel(0)]
    .map(part => part.toString(16).padStart(2, '0'))
    .join('')}`
}

export function resolveAccent(id: string | undefined): PetAccent {
  return PET_ACCENTS.find(accent => accent.id === id) ?? PET_ACCENTS[0]!
}

/** Event announcing that the glyph or size changed. */
export const PET_APPEARANCE_EVENT = 'dsh-pet:appearance-changed'

/**
 * Event announcing that the installed Skill set changed.
 *
 * Settings and the mascot are separate mount points, so adding or enabling a
 * Skill must tell the menu to reload rather than leave it showing whatever it
 * fetched when it mounted.
 */
export const PET_SKILLS_EVENT = 'dsh-pet:skills-changed'

/** The glyph shown when the user has not chosen one. */
export const DEFAULT_GLYPH = '🐾'

/**
 * Keep only the first user-perceived character.
 *
 * Counting code points is wrong here: 👩‍💻 is three of them and 👨‍👩‍👧 is five,
 * yet each is a single visible glyph. `Intl.Segmenter` splits on grapheme
 * clusters, so a composed emoji survives intact instead of being cut into
 * replacement characters.
 * @param raw - Raw user input.
 * @returns the first grapheme, or an empty string.
 */
function firstGrapheme(raw: string): string {
  const Segmenter = (globalThis as { Intl?: { Segmenter?: typeof Intl.Segmenter } }).Intl
    ?.Segmenter
  if (Segmenter === undefined) {
    // Older engines: fall back to code points. Worse for composed emoji, but
    // never worse than cutting a surrogate pair in half.
    return [...raw][0] ?? ''
  }
  const segmenter = new Segmenter('en', { granularity: 'grapheme' })
  return [...segmenter.segment(raw)][0]?.segment ?? ''
}

/** Selectable mascot diameters, in pixels. */
export const PET_SIZES = [
  { id: 'small', label: '小', px: 56 },
  { id: 'medium', label: '中', px: 72 },
  { id: 'large', label: '大', px: 88 },
] as const

/** Identifier of one size option. */
export type PetSizeId = (typeof PET_SIZES)[number]['id']

/** Diameter used when the user has not chosen one. */
export const DEFAULT_SIZE_PX = 72

/**
/**
 * Keep only the first user-perceived character of a glyph.
 *
 * Blank input returns an empty string, which the caller treats as "restore
 * the default" — an invisible glyph would leave a mascot nobody can click.
 * @param raw - Raw user input.
 * @returns the normalized glyph, or an empty string.
 */
export function normalizeGlyph(raw: string): string {
  return firstGrapheme(raw.trim())
}

