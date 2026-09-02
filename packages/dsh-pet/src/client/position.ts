/**
 * Persisted Pet overlay position.
 *
 * Position is a root-scoped client preference (not Host state): it describes
 * where this browser shows the mascot and is meaningless to Pet Tasks. It is
 * always clamped into the visible viewport on read, so a window resize or a
 * display change can never strand Pet off-screen.
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
 * @returns the clamped position.
 */
export function clampPosition(
  position: PetPosition,
  viewport: { width: number; height: number },
  size: number = PET_SIZE,
): PetPosition {
  // The mascot is resizable, so clamping against a fixed constant would let a
  // larger Pet be dragged partly off-screen and become unreachable.
  const maxX = Math.max(0, viewport.width - size)
  const maxY = Math.max(0, viewport.height - size)
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY),
  }
}

/**
 * Read the persisted position, clamped to the current viewport.
 *
 * Corrupt or non-numeric storage falls back to the default rather than
 * throwing, so a bad value cannot prevent Pet from mounting.
 * @param viewport - Current viewport size.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the position to render at.
 */
export function readPosition(
  viewport: { width: number; height: number },
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
): PetPosition {
  try {
    const raw = storage?.getItem(POSITION_KEY)
    if (raw === null || raw === undefined) return defaultPosition(viewport)
    const parsed = JSON.parse(raw) as Partial<PetPosition>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return defaultPosition(viewport)
    }
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return defaultPosition(viewport)
    }
    return clampPosition({ x: parsed.x, y: parsed.y }, viewport)
  } catch {
    return defaultPosition(viewport)
  }
}

/**
 * Persist a position, clamped first.
 * @param position - Position to persist.
 * @param viewport - Current viewport size.
 * @param storage - Storage implementation; defaults to `localStorage`.
 * @returns the clamped position that was written.
 */
export function writePosition(
  position: PetPosition,
  viewport: { width: number; height: number },
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
): PetPosition {
  const clamped = clampPosition(position, viewport)
  try {
    storage?.setItem(POSITION_KEY, JSON.stringify(clamped))
  } catch {
    // A full or unavailable storage must not break dragging.
  }
  return clamped
}

