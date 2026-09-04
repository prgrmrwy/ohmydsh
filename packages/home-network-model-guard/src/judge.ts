/**
 * Pure guard decision: convert network + selection facts into a block action.
 *
 * Pure by construction (no cordis, no DOM, no clock), so the full spec
 * scenario table (region×Claude quadrants, fail closed, official-yield) is
 * unit-testable offline.
 *
 * @module dsh-home-network-model-guard/judge
 */
import type { NetworkVerdict } from './contract.js'
import { isClaudeFamily } from './rules.js'

/** The model-selection facts the guard may act on. */
export interface SelectionFacts {
  readonly provider: string
  readonly model: string
}

/** Everything the guard needs to decide for one session. */
export interface JudgeInput {
  /**
   * Host egress classification. `'blocked'` and `'unknown'` both fail closed
   * for Claude; only `'allowed'` permits it.
   */
  readonly network: NetworkVerdict
  /**
   * The official model-directory routable flag. `false` means the official
   * ui-model-selection plugin owns the composer block (its adapter cannot
   * route the selection) — the guard MUST yield, never write or clear there.
   * `null` (not yet loaded) is treated as not-blocked, matching the official
   * publish (`routable === false` is the only value it blocks on).
   */
  readonly routable: boolean
  /** The per-session selection; `null` while none is loaded. */
  readonly selection: SelectionFacts | null
}

/** What the guard should do with the session's composer block slot. */
export type GuardAction = 'block' | 'yield-official' | 'none'

/**
 * One pure decision.
 *
 * - `'block'`: Claude-family selection ∧ egress is NOT `'allowed'` (fail closed
 *   on blocked AND unknown).
 * - `'yield-official'`: official non-routable block owns the slot.
 * - `'none'`: non-Claude selection, no selection, or an `'allowed'` egress.
 *
 * @param input - the facts snapshot for one session.
 * @returns the action to apply.
 */
export function judge(input: JudgeInput): GuardAction {
  if (input.routable === false) return 'yield-official'
  if (input.selection === null) return 'none'
  if (!isClaudeFamily(input.selection.provider, input.selection.model)) return 'none'
  if (input.network === 'allowed') return 'none'
  return 'block'
}