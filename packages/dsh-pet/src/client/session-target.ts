/**
 * Map Pet's navigation target to the DSH 0.2.0 `SessionTarget`
 * (`SessionId | SubagentAddress`) accepted by `uiWorkspace.openSession`.
 *
 * Kept free of runtime imports so it is testable without a Client context.
 */
import type { PetSessionTarget } from './settings.js'

/** Structural mirror of DSH's SubagentAddress for a continuable locus child. */
export interface ContinuableSubagentAddress {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'continuable'
}

export function sessionTargetOf(target: PetSessionTarget): never {
  if (target.kind === 'subagent') {
    const address: ContinuableSubagentAddress = {
      parentSessionId: target.parentSessionId,
      childSessionId: target.childSessionId,
      mode: 'continuable',
    }
    return address as never
  }
  return target.sessionId as never
}
