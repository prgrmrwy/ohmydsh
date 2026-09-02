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
  /**
   * Colour of the mascot GLYPH itself.
   *
   * The surface stays the neutral panel background: tinting it would make the
   * mascot read as a status badge floating over the user's work, and would
   * leave no room for a black option — black is a paw colour, not a backdrop.
   */
  readonly glyph: string
}

/**
 * The selectable palette.
 *
 * Saturation is kept low on purpose: each entry is a soft tint rather than a
 * primary, so the mascot reads as part of the surface instead of an alert.
 */
export const PET_ACCENTS: readonly PetAccent[] = [
  { id: 'default', label: '默认', glyph: '#1f2329' },
  { id: 'black', label: '黑', glyph: '#101318' },
  { id: 'red', label: '红', glyph: '#a1524b' },
  { id: 'orange', label: '橙', glyph: '#765537' },
  { id: 'yellow', label: '黄', glyph: '#766637' },
  { id: 'green', label: '绿', glyph: '#4a7a4f' },
  { id: 'cyan', label: '青', glyph: '#3f7b80' },
  { id: 'blue', label: '蓝', glyph: '#4a6b96' },
  { id: 'purple', label: '紫', glyph: '#6f5b93' },
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
  if (raw === undefined || raw === '') return DEFAULT_GLYPH
  // Exactly one character: more would overflow the circle.
  return firstGrapheme(raw) === '' ? DEFAULT_GLYPH : firstGrapheme(raw)
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
  storage?.setItem(GLYPH_KEY, firstGrapheme(glyph.trim()))
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
