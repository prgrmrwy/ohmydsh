/**
 * Whether an imported animation is currently active, shared between the two
 * React roots (overlay and settings).
 *
 * The settings panel can be mounted before the owner imports an animation and
 * kept mounted afterwards, so a one-shot read inside Settings raced the real
 * state and left the Emoji tab selected. The overlay always mounts with the
 * app and reads the projection, so it publishes presence here; Settings
 * subscribes and opens the form that is actually in use.
 *
 * @module dsh-pet/client/expression-presence
 */

/** What is known about the stored animation. */
export type ExpressionPresence = 'unknown' | 'none' | 'ok'

let presence: ExpressionPresence = 'unknown'

/** Listeners notified when the presence changes. */
const listeners = new Set<() => void>()

/**
 * Publish the current presence.
 * @param next - New presence; no-op when unchanged.
 */
export function setExpressionPresence(next: ExpressionPresence): void {
  if (presence === next) return
  presence = next
  for (const listener of listeners) listener()
}

/**
 * Read the current presence (also usable as a server snapshot).
 * @returns the last published presence.
 */
export function getExpressionPresence(): ExpressionPresence {
  return presence
}

/**
 * Subscribe to presence changes.
 * @param listener - Called after every change.
 * @returns the unsubscribe function.
 */
export function subscribeExpressionPresence(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
