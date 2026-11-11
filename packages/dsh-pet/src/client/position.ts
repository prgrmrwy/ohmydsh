/**
 * Persisted Pet overlay position.
 *
 * Position is a root-scoped client preference (not Host state): it describes
 * where this browser shows the mascot and is meaningless to Pet Tasks.
 *
 * The saved pair is an ANCHOR, not the final render position. Clamping to the
 * viewport happens on a copy at render time (`resolvePosition`), never on the
 * anchor itself. That split is load-bearing: Pet is mounted on its own root in
 * whatever page hosts it, and some hosts embed that page in an iframe whose
 * layout is not settled when the client bundle runs. A hidden or not-yet-sized
 * iframe measures 0x0, and an iframe whose size the host has not applied
 * measures its default box; clamping at READ time would replace the anchor with
 * that transient box's corner, and because clamping only ever pushes inward the
 * saved spot would never come back once the real viewport arrived. The stored
 * value stayed correct, which is why a plain reload at the right size looked
 * fine while every embedded load landed somewhere else.
 */

/** Storage key for the persisted position. */
export const POSITION_KEY = 'dsh.pet.v1.position'

/** A viewport position in CSS pixels from the top-left corner. */
export interface PetPosition {
  readonly x: number
  readonly y: number
}

/** Rendered size of the Pet surface, used for clamping. */
export const PET_SIZE = 72

/** Default position: bottom-right with a comfortable margin. */
export function defaultPosition(viewport: { width: number; height: number }): PetPosition {
  return {
    x: Math.max(0, viewport.width - PET_SIZE - 24),
    y: Math.max(0, viewport.height - PET_SIZE - 96),
  }
}

/**
 * Clamp a position so the whole Pet surface stays visible.
 * @param position - Candidate position.
 * @param viewport - Current viewport size.
 * @param size - Rendered Pet diameter; the mascot is resizable, so a fixed
 *   constant would let a larger Pet be dragged partly off-screen.
 * @returns the clamped position.
 */
export function clampPosition(
  position: PetPosition,
  viewport: { width: number; height: number },
  size: number = PET_SIZE,
): PetPosition {
  const maxX = Math.max(0, viewport.width - size)
  const maxY = Math.max(0, viewport.height - size)
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  }
}

/**
 * Read the saved anchor, WITHOUT clamping it to any viewport.
 *
 * Deliberately total: absent, corrupt or non-numeric storage yields
 * `undefined` instead of throwing, so a bad value cannot prevent Pet from
 * mounting. The caller decides where to render.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the saved position, or `undefined` when none can be trusted.
 */
export function readPosition(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
): PetPosition | undefined {
  try {
    const raw = storage?.getItem(POSITION_KEY)
    if (raw === null || raw === undefined) return undefined
    const parsed = JSON.parse(raw) as Partial<PetPosition>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return undefined
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return undefined
    // No clamp here: the stored anchor is the user's intent and must survive a
    // viewport that is still settling. `resolvePosition` clamps for display.
    return { x: parsed.x, y: parsed.y }
  } catch {
    return undefined
  }
}

/**
 * Resolve the position to RENDER for the current viewport and mascot size.
 *
 * A saved anchor is clamped so Pet can never be stranded off-screen; without a
 * saved anchor the default bottom-right spot follows the current viewport. The
 * clamp is recomputed from the anchor on every render, so a viewport that
 * shrinks temporarily (or measures 0x0 before its host lays the page out) only
 * moves the drawing — when the viewport grows back, Pet returns to the exact
 * saved spot instead of sticking to the temporary box's corner.
 * @param anchor - Saved position, or `undefined` when nothing usable is stored.
 * @param viewport - Current viewport size.
 * @param size - Rendered Pet diameter in CSS pixels.
 * @returns the position to render at.
 */
export function resolvePosition(
  anchor: PetPosition | undefined,
  viewport: { width: number; height: number },
  size: number = PET_SIZE,
): PetPosition {
  return clampPosition(anchor ?? defaultPosition(viewport), viewport, size)
}

/**
 * Persist a position, clamped first.
 * @param position - Position to persist.
 * @param viewport - Current viewport size.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @param size - Rendered Pet diameter in CSS pixels.
 * @returns the clamped position that was written.
 */
export function writePosition(
  position: PetPosition,
  viewport: { width: number; height: number },
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
  size: number = PET_SIZE,
): PetPosition {
  const clamped = clampPosition(position, viewport, size)
  try {
    storage?.setItem(POSITION_KEY, JSON.stringify(clamped))
  } catch {
    // A full or unavailable storage must not break dragging.
  }
  return clamped
}
