/**
 * Cross-root diagnostics for the mascot animation.
 *
 * The mascot and Settings are separate React roots. A render failure is only
 * observable inside the mascot root, but the owner needs to see it in Settings;
 * this tiny module-level store plus one DOM event is the shared channel. It
 * carries a display string, never animation content.
 */

/** Event announcing that the mascot expression diagnostic changed. */
export const PET_EXPRESSION_EVENT = 'dsh-pet:expression-changed'

/** Current failure reason, if the last mount attempt failed. */
let diagnostic: string | undefined

/**
 * Read the current diagnostic.
 * @returns the reason, or `undefined` when the mascot is healthy/absent.
 */
export function getMascotExpressionDiagnostic(): string | undefined {
  return diagnostic
}

/**
 * Publish a diagnostic (or clear it) to every subscribed root.
 * @param reason - Failure reason, or `undefined` to clear.
 */
export function setMascotExpressionDiagnostic(reason: string | undefined): void {
  if (diagnostic === reason) return
  diagnostic = reason
  globalThis.dispatchEvent?.(new Event(PET_EXPRESSION_EVENT))
}

/**
 * Subscribe to diagnostic changes.
 * @param listener - Called after every change.
 * @returns the unsubscribe function.
 */
export function subscribeMascotExpressionDiagnostic(listener: () => void): () => void {
  globalThis.addEventListener?.(PET_EXPRESSION_EVENT, listener)
  return () => globalThis.removeEventListener?.(PET_EXPRESSION_EVENT, listener)
}
