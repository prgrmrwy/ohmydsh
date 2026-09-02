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
