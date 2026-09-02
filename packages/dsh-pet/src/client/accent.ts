/**
 * Pet mascot accent colour.
 *
 * Stored per browser alongside the position, not in Host config: it is a
 * display preference for this device, and one Host may be open on several
 * screens with different backgrounds.
 *
 * The palette is deliberately desaturated. The mascot sits above real work
 * for the whole session, so a vivid badge would compete with the content it
 * floats over. Every entry is generated at a single HSL saturation (30%) and
 * lightness (86%), which keeps the seven hues consistent with each other and
 * holds glyph contrast above the 4.5:1 readability threshold.
 */

/** Storage key for the chosen accent. */
export const ACCENT_KEY = 'dsh.pet.v1.accent'

/** Event announcing that the accent changed. */
export const PET_ACCENT_EVENT = 'dsh-pet:accent-changed'

/** Identifier of one palette entry. */
export type PetAccentId =
  | 'default'
  | 'black'
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
  /** Mascot background. */
  readonly background: string
  /** Glyph colour that stays legible on that background. */
  readonly foreground: string
}

/**
 * The selectable palette.
 *
 * Saturation is kept low on purpose: each entry is a soft tint rather than a
 * primary, so the mascot reads as part of the surface instead of an alert.
 */
export const PET_ACCENTS: readonly PetAccent[] = [
  { id: 'default', label: '默认', background: '#ffffff', foreground: '#1f2329' },
  // The one deliberately unsaturated entry: a dark body with a light glyph,
  // inverting the palette rather than tinting it.
  { id: 'black', label: '黑', background: '#2b2f36', foreground: '#e8eaed' },
  { id: 'red', label: '红', background: '#e6d4d1', foreground: '#653c34' },
  { id: 'orange', label: '橙', background: '#e6dbd1', foreground: '#654b34' },
  { id: 'yellow', label: '黄', background: '#e6e2d1', foreground: '#655b34' },
  { id: 'green', label: '绿', background: '#d1e6d2', foreground: '#346538' },
  { id: 'cyan', label: '青', background: '#d1e4e6', foreground: '#346165' },
  { id: 'blue', label: '蓝', background: '#d1dae6', foreground: '#344865' },
  { id: 'purple', label: '紫', background: '#dbd1e6', foreground: '#4c3465' },
]

/**
 * Resolve an accent id to its palette entry.
 * @param id - Stored identifier, possibly unknown.
 * @returns the matching accent, falling back to the default.
 */
export function resolveAccent(id: string | undefined): PetAccent {
  return PET_ACCENTS.find(accent => accent.id === id) ?? PET_ACCENTS[0]!
}

/**
 * Read the stored accent.
 *
 * An unknown or corrupt value falls back to the default rather than throwing:
 * a bad preference must never stop the mascot from rendering.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the resolved accent.
 */
export function readAccent(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): PetAccent {
  return resolveAccent(storage?.getItem(ACCENT_KEY) ?? undefined)
}

/**
 * Persist the accent and tell any live Pet surface to re-read it.
 *
 * The overlay reads the accent once into React state, so writing alone would
 * appear to do nothing until a reload.
 * @param id - Accent to store.
 * @param storage - Storage implementation; defaults to `localStorage`.
 */
export function writeAccent(
  id: PetAccentId,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(ACCENT_KEY, id)
  globalThis.dispatchEvent?.(new Event(PET_ACCENT_EVENT))
}

/** Storage key for the chosen glyph. */
export const GLYPH_KEY = 'dsh.pet.v1.glyph'

/** Storage key for the chosen size. */
export const SIZE_KEY = 'dsh.pet.v1.size'

/** Event announcing that the glyph or size changed. */
export const PET_APPEARANCE_EVENT = 'dsh-pet:appearance-changed'

/** The glyph shown when the user has not chosen one. */
export const DEFAULT_GLYPH = '🐾'

/** Suggested glyphs; the field also accepts any other emoji. */
export const PET_GLYPH_SUGGESTIONS: readonly string[] = [
  '🐾',
  '🐱',
  '🐶',
  '🦊',
  '🐼',
  '🐧',
  '🦉',
  '🐢',
  '🤖',
  '👻',
  '🌵',
  '⭐',
]

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
 * Read the stored glyph.
 *
 * Empty or whitespace-only input falls back to the default rather than
 * rendering an invisible mascot the user could no longer click.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the glyph to render.
 */
export function readGlyph(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): string {
  const raw = storage?.getItem(GLYPH_KEY)?.trim()
  // Cap the length: a long string would overflow the circle. Emoji are
  // multi-code-point, so this counts grapheme-ish units via the spread.
  if (raw === undefined || raw === '') return DEFAULT_GLYPH
  return [...raw].slice(0, 4).join('')
}

/**
 * Persist the glyph and tell any live Pet surface to re-read it.
 * @param glyph - Chosen glyph; blank restores the default.
 * @param storage - Storage implementation; defaults to `localStorage`.
 */
export function writeGlyph(
  glyph: string,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(GLYPH_KEY, glyph.trim())
  globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
}

/**
 * Read the stored diameter.
 *
 * An unknown or non-numeric value falls back to the default: a bad preference
 * must never make the mascot unclickable.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the diameter in pixels.
 */
export function readSize(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): number {
  const raw = storage?.getItem(SIZE_KEY)
  return PET_SIZES.find(size => size.id === raw)?.px ?? DEFAULT_SIZE_PX
}

/**
 * Persist the size and tell any live Pet surface to re-read it.
 * @param id - Chosen size.
 * @param storage - Storage implementation; defaults to `localStorage`.
 */
export function writeSize(
  id: PetSizeId,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  storage?.setItem(SIZE_KEY, id)
  globalThis.dispatchEvent?.(new Event(PET_APPEARANCE_EVENT))
}
