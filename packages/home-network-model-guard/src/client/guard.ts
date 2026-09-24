/**
 * Framework-free composer-block guard controller.
 *
 * Owns the coexistence discipline with the official `ui-model-selection`
 * blocks writer (design Decisions 4):
 *
 * - **Never unconditionally clears** the slot. `'none'` clears only when the
 *   LAST write was ours; `'yield-official'` (official `routable === false`
 *   block owns the session) drops our claim WITHOUT touching the slot, so an
 *   official block we might have raced is never erased by us.
 * - **Re-assert self-check**: the official plugin publishes `undefined` on
 *   every directory store change and could in principle run after ours. We
 *   subscribe the block slot itself; when our action is `'block'` but the
 *   slot does not hold our reason, we re-assert once (debounced via a 0ms
 *   task so the other writer's publish settles first). The registry is
 *   idempotent (`set` with an equal block notifies nobody), so there is no
 *   write loop.
 *
 * All deps are injected (no cordis, no DOM), so these semantics are
 * unit-testable offline.
 *
 * @module dsh-home-network-model-guard/client/guard
 */
import type { NetworkVerdict } from '../contract.js'
import { judge, type SelectionFacts } from '../judge.js'

/** The block value this plugin writes (structural subset of ComposerBlock). */
export interface ReasonBlock {
  readonly reason: string
}

/** Everything the controller needs from the cordis wiring layer. */
export interface SessionGuardDeps {
  /** Latest host network verdict (`'unknown'` while unavailable → fail open). */
  network(): NetworkVerdict
  /**
   * One facts snapshot for a session; `undefined` when the session is not
   * (yet) materialized — the caller retries on the next signal.
   */
  read(sessionId: string): { selection: SelectionFacts | null; routable: boolean } | undefined
  /** Subscribe the session's model-directory store (fires immediately). */
  subscribeSelection(sessionId: string, onChange: () => void): () => void
  /** Subscribe the session's composer-block slot (fires immediately). */
  subscribeBlockStore(sessionId: string, onChange: () => void): () => void
  /** Current composer-block value for the session. */
  blockOf(sessionId: string): ReasonBlock | undefined
  /** Write the composer-block slot. */
  setBlock(sessionId: string, block: ReasonBlock | undefined): void
  /** The localized reason string this plugin owns. */
  reason(): string
}

interface SessionState {
  /** Whether the current block value (if any) was written by us. */
  owns: boolean
  /** One in-flight debounced re-assert per session. */
  reassertQueued: boolean
}

/**
 * Per-session guard application over the composer-block slot.
 */
export class ComposerGuardController {
  private readonly states = new Map<string, SessionState>()

  public constructor(private readonly deps: SessionGuardDeps) {}

  /**
   * Recompute and apply the guard for one session. Call on selection changes,
   * network verdict changes, and session (re)binding. Never throws.
   * @param sessionId - the session to evaluate.
   */
  public evaluate(sessionId: string): void {
    if (this.readFacts(sessionId) === undefined) return
    const state = this.stateOf(sessionId)
    switch (this.actionOf(sessionId)) {
      case 'block':
        this.deps.setBlock(sessionId, { reason: this.deps.reason() })
        state.owns = true
        return
      case 'yield-official':
        // The official block owns the slot; our previous claim must not clear
        // it. The official publish has already (or will) write its reason.
        state.owns = false
        return
      case 'none':
        if (state.owns) {
          this.deps.setBlock(sessionId, undefined)
          state.owns = false
        }
        return
    }
  }

  /**
   * Block-slot self-check: when we intend to block but the slot does not hold
   * our reason (another publish cleared or overwrote it), re-assert once,
   * debounced. Call from the slot subscription.
   * @param sessionId - the session whose slot changed.
   */
  public onBlockStoreChanged(sessionId: string): void {
    if (this.actionOf(sessionId) !== 'block') return
    const current = this.deps.blockOf(sessionId)
    if (current !== undefined && current.reason === this.deps.reason()) return
    const state = this.stateOf(sessionId)
    if (state.reassertQueued) return
    state.reassertQueued = true
    setTimeout(() => {
      state.reassertQueued = false
      // Re-read everything: verdict/selection may have settled meanwhile.
      if (this.actionOf(sessionId) !== 'block') return
      this.deps.setBlock(sessionId, { reason: this.deps.reason() })
      this.stateOf(sessionId).owns = true
    }, 0)
  }

  /**
   * Session teardown: clear the slot only when our own block is the current
   * value; drop all per-session state. The official disposer clears its own
   * blocks separately.
   * @param sessionId - the session being torn down.
   */
  public dispose(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state !== undefined && state.owns) this.deps.setBlock(sessionId, undefined)
    this.states.delete(sessionId)
  }

  private readFacts(sessionId: string): { selection: SelectionFacts | null; routable: boolean } | undefined {
    return this.deps.read(sessionId)
  }

  private actionOf(sessionId: string): ReturnType<typeof judge> {
    const facts = this.deps.read(sessionId)
    if (facts === undefined) return 'none'
    return judge({ network: this.deps.network(), routable: facts.routable, selection: facts.selection })
  }

  private stateOf(sessionId: string): SessionState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = { owns: false, reassertQueued: false }
      this.states.set(sessionId, state)
    }
    return state
  }
}